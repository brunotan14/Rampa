defmodule Rampa.Audits do
  @moduledoc """
  Auditorias, páginas, tarefas e achados (PRD §8) e o ciclo de vida deles
  (regras em `Rampa.Audits.Rules`).

  Este módulo ainda não cria auditorias: elas só podem nascer em `POST /api/audits`, depois
  da validação de URL e da proteção contra SSRF (RF-RA001, RF-RA002).

  ## Tarefas e conclusão

  Cada página tem tarefas (`Rampa.Audits.PageTask`): `scan` agora, análises de IA no M4. O
  estado da página é derivado das tarefas (`Rampa.Audits.Rules.page_status/1`), e a auditoria
  termina quando nenhuma tarefa de nenhuma página está `pending` ou `running`
  (`Rampa.Audits.Rules.audit_outcome/1`). A decisão é tomada na mesma transação que fecha a
  tarefa, nunca consulta a fila do Oban, e os contadores da auditoria são recalculados a partir
  das páginas: repetir não conta duas vezes.

  ## Travas

  Toda transição trava, nesta ordem e com `FOR UPDATE`, a **auditoria**, a **página** e as
  **tarefas** da página. Toda escrita em páginas e tarefas de uma auditoria acontece com a
  linha dela travada; por isso a regra de conclusão lê as outras páginas sem travá-las.

  Auditoria em estado final (`completed`, `failed`, `cancelled`), tarefa já terminada ou, ao
  acrescentar tarefa, página já terminada não mudam mais: a função devolve
  `{:error, :already_finished}`.
  """

  import Ecto.Query

  require Logger

  alias Rampa.Audits.{Audit, AxeMapper, Finding, Page, PageData, PageTask, Rules, ScanPageJob}
  alias Rampa.Repo
  alias Rampa.Security.URLGuard

  # Limite de parâmetros do PostgreSQL (65 535) dividido pelas colunas de `findings`, com folga.
  @insert_chunk_size 1_000

  # O título vem da página: guardar só o necessário para identificá-la.
  @title_max_bytes 512

  # Tipo de tarefa → job que a executa (args: `%{"page_id" => id}`). As análises de IA ganham
  # job no M4; até lá, uma tarefa delas presa é fechada como falha pela reconciliação.
  @task_workers %{scan: ScanPageJob}

  # Estados do Oban em que o job ainda vai rodar ou está rodando: os mesmos da chave única.
  @live_job_states Enum.map(Oban.Job.unique_states(:incomplete), &Atom.to_string/1)

  @type transition_error ::
          :page_not_found | :task_not_found | :already_finished | :scan_not_finished
  @type add_page_error ::
          URLGuard.reason()
          | :audit_not_found
          | :already_finished
          | :page_limit_reached
          | :duplicate_url

  ## Criação de páginas e tarefas

  @doc """
  Acrescenta uma página a uma auditoria aberta, com a tarefa `scan` `pending` e o
  `ScanPageJob`, tudo numa transação. Preparo do M5 (páginas descobertas); não cria auditoria.

  A URL passa pelo `Rampa.Security.URLGuard` antes de a transação abrir: nenhuma URL entra
  sem a proteção contra SSRF, e a consulta de DNS não acontece com a auditoria travada. A
  página guarda a URL normalizada.

  Recusa auditoria encerrada (`:already_finished`), URL repetida na auditoria
  (`:duplicate_url`) e página além do `page_limit` (`:page_limit_reached`).
  """
  @spec add_page(Ecto.UUID.t(), String.t()) ::
          {:ok, Page.t()} | {:error, add_page_error() | Ecto.Changeset.t()}
  def add_page(audit_id, url) do
    with {:ok, url} <- URLGuard.validate(url) do
      Repo.transact(fn -> insert_page(audit_id, url) end)
    end
  end

  defp insert_page(audit_id, url) do
    with {:ok, audit} <- lock_audit(audit_id),
         :ok <- check_new_page(audit, url),
         {:ok, page} <- Repo.insert(Page.create_changeset(audit, url)),
         {:ok, _task} <- Repo.insert(PageTask.create_changeset(page, %{kind: :scan})),
         {:ok, _job} <- Oban.insert(ScanPageJob.new(%{"page_id" => page.id})),
         {:ok, _audit} <- settle(audit, now()) do
      {:ok, page}
    end
  end

  @doc """
  Acrescenta uma tarefa `pending` a uma página aberta de uma auditoria aberta. Preparo do M4:
  ainda não enfileira job, porque os jobs de IA nascem lá.

  Recusa tipo desconhecido (`:invalid_kind`), tipo que a página já tem (`:duplicate_task`) e
  página ou auditoria encerrada (`:already_finished`).
  """
  @spec add_task(Ecto.UUID.t(), PageTask.kind()) ::
          {:ok, PageTask.t()}
          | {:error, transition_error() | :invalid_kind | :duplicate_task | Ecto.Changeset.t()}
  def add_task(page_id, kind) do
    if kind in PageTask.kinds(),
      do: Repo.transact(fn -> insert_task(page_id, kind) end),
      else: {:error, :invalid_kind}
  end

  defp insert_task(page_id, kind) do
    with {:ok, audit, page, tasks} <- lock_chain(page_id),
         :ok <- check_page_open(page),
         :ok <- check_new_kind(tasks, kind),
         {:ok, task} <- Repo.insert(PageTask.create_changeset(page, %{kind: kind})),
         {:ok, _page} <- refresh_page(page, tasks ++ [task]),
         {:ok, _audit} <- settle(audit, now()) do
      {:ok, task}
    end
  end

  ## Transições das tarefas

  @doc """
  Começa a tarefa `kind` da página: `running`, com `started_at` e o `attempt` (o maior entre
  o anterior + 1 e o do Oban). A página passa ao estado derivado e a auditoria a `running`
  (com `started_at`, se ainda nulo). Aceita tarefa `pending` ou `running` (nova tentativa).
  Tarefa que não é `scan` só começa depois de o `scan` da página terminar
  (`{:error, :scan_not_finished}`): as análises dependem dos dados dele.

  Devolve a tarefa com a página em `page`.
  """
  @spec start_task(Ecto.UUID.t(), PageTask.kind(), pos_integer()) ::
          {:ok, PageTask.t()} | {:error, transition_error() | Ecto.Changeset.t()}
  def start_task(page_id, kind, job_attempt) do
    Repo.transact(fn ->
      now = now()

      with {:ok, audit, page, tasks} <- lock_chain(page_id),
           {:ok, task} <- fetch_open_task(tasks, kind),
           :ok <- check_scan_finished(tasks, kind),
           {:ok, task} <-
             update_task(task, %{
               status: :running,
               attempt: max(task.attempt + 1, job_attempt),
               error: nil,
               started_at: now,
               finished_at: nil
             }),
           {:ok, page} <- refresh_page(page, replace(tasks, task)),
           {:ok, _audit} <-
             Repo.update(
               Audit.progress_changeset(audit, %{
                 status: :running,
                 started_at: audit.started_at || now
               })
             ) do
        {:ok, %{task | page: page}}
      end
    end)
  end

  @doc """
  Grava o resultado do scanner e fecha a tarefa `scan` `done`: os fatos da página, um achado
  por nó do axe e a regra de conclusão, numa transação.

  O resultado é saneado antes (`Rampa.Audits.PageData`): sem NUL e com o título cortado em
  #{@title_max_bytes} bytes. Resultado sem o campo `axe` devolve
  `{:error, :invalid_scan_result}`; achado que não passa no changeset devolve
  `{:error, changeset}` e nada é gravado.

  Os achados `source: :axe` da página são apagados e regravados na mesma transação: varrer a
  página de novo não duplica nada. Achados de outras fontes ficam.
  """
  @spec record_scan_result(Page.t(), map()) ::
          {:ok, Page.t()}
          | {:error, transition_error() | :invalid_scan_result | Ecto.Changeset.t()}
  def record_scan_result(%Page{id: page_id}, result) do
    case PageData.sanitize(result) do
      %{"axe" => %{} = axe} = result -> Repo.transact(fn -> save_scan(page_id, result, axe) end)
      _invalid -> {:error, :invalid_scan_result}
    end
  end

  @doc """
  Fecha a tarefa `kind` da página como `failed`, com o código de erro, e roda a regra de
  conclusão. Se a tarefa é o `scan`, as outras tarefas abertas da página fecham `failed` com
  `"scan_failed"` (dependem dos dados dele) e a página fica `failed`; falha de outra tarefa
  deixa a página seguir até `done`.
  """
  @spec fail_task(Ecto.UUID.t(), PageTask.kind(), atom() | String.t()) ::
          {:ok, Page.t()} | {:error, transition_error() | Ecto.Changeset.t()}
  def fail_task(page_id, kind, code) when is_atom(code) or is_binary(code) do
    Repo.transact(fn ->
      with {:ok, audit, page, tasks} <- lock_chain(page_id),
           {:ok, task} <- fetch_open_task(tasks, kind) do
        fail_locked(audit, page, tasks, task, to_string(code), now())
      end
    end)
  end

  ## Reconciliação

  @doc """
  Reconcilia tarefas presas de auditorias abertas. Critérios em
  `config :rampa, :task_reconciliation` (segundos), sobrescritos por `opts`:

    * tarefa `running` sem job vivo no Oban, com `started_at` mais antigo que o `timeout` do
      job + `:running_grace` (tipos com job) ou que `:stale_running_after` (tipos sem job).
      Sem job vivo, o job terminou sem fechar a tarefa (descartado, morto pelo timeout,
      falha ao gravar). Se ainda há tentativa (`attempt < max_attempts`) e reenfileiramento
      (`requeues < :max_requeues`), um job novo é inserido e a tarefa volta a `pending`;
      senão, fecha `failed` com `"stale"` e a regra de conclusão roda;
    * tarefa `pending` sem job vivo, parada há mais de `:stale_pending_after`. Uma tarefa que
      não é `scan` só conta a partir do fim do `scan` da página (antes disso ela espera de
      propósito). Reenfileira enquanto `requeues < :max_requeues`; depois, ou se o tipo não
      tem job, fecha `failed` com `"stale"`;
    * `:batch_size`: no máximo tantas tarefas por rodada;
    * `:now`: o instante de referência (testes).

  Tarefa com job vivo nunca é candidata: o Oban (e o `Oban.Lifeline`) ainda vai rodá-la.
  Assim o lote só traz tarefas que pedem ação, e uma fila cheia não ocupa o lote para sempre.
  Consultar o Oban aqui é aceitável porque a reconciliação não decide o fim da auditoria.

  Cada tarefa é tratada na sua transação, com as travas de sempre e o critério conferido de
  novo depois de travar. Se o `Oban.insert/1` encontra um job vivo (corrida com a consulta),
  nada muda e a tarefa conta como `:unchanged`.

  Devolve quantas tarefas foram reenfileiradas, fechadas como falha, deixadas como estavam e
  quantas deram erro.
  """
  @spec reconcile_stale_tasks(keyword()) :: %{
          requeued: non_neg_integer(),
          failed: non_neg_integer(),
          unchanged: non_neg_integer(),
          error: non_neg_integer()
        }
  def reconcile_stale_tasks(opts \\ []) do
    config = Keyword.merge(Application.get_env(:rampa, :task_reconciliation, []), opts)
    now = Keyword.get_lazy(config, :now, &now/0)

    criteria = %{
      now: now,
      running_before:
        Map.new(PageTask.kinds(), &{&1, DateTime.add(now, -running_after(&1, config))}),
      pending_before: DateTime.add(now, -Keyword.fetch!(config, :stale_pending_after)),
      max_requeues: Keyword.fetch!(config, :max_requeues)
    }

    criteria
    |> stale_tasks_query(Keyword.fetch!(config, :batch_size))
    |> Repo.all()
    |> Enum.map(&reconcile_task(&1, criteria))
    |> Enum.frequencies()
    |> then(&Map.merge(%{requeued: 0, failed: 0, unchanged: 0, error: 0}, &1))
  end

  # Prazo de uma tarefa `running`, em segundos: o `timeout` do job mais uma folga. Tipo sem job
  # usa o prazo fixo.
  defp running_after(kind, config) do
    case Map.fetch(@task_workers, kind) do
      {:ok, worker} ->
        div(worker.timeout(%Oban.Job{}), 1_000) + Keyword.fetch!(config, :running_grace)

      :error ->
        Keyword.fetch!(config, :stale_running_after)
    end
  end

  defp stale_tasks_query(criteria, batch_size) do
    from t in PageTask,
      as: :task,
      join: a in Audit,
      on: a.id == t.audit_id,
      join: s in PageTask,
      as: :scan,
      on: s.page_id == t.page_id and s.kind == :scan,
      where: a.status not in ^Audit.final_statuses(),
      where: ^dynamic(^stale_running(criteria) or ^stale_pending(criteria)),
      where: not exists(live_jobs_query()),
      order_by: [asc: t.updated_at, asc: t.id],
      limit: ^batch_size,
      select: {t.id, t.page_id}
  end

  defp stale_running(criteria) do
    Enum.reduce(criteria.running_before, dynamic(false), fn {kind, before}, acc ->
      dynamic(
        [task: t],
        ^acc or (t.status == :running and t.kind == ^kind and t.started_at < ^before)
      )
    end)
  end

  defp stale_pending(%{pending_before: before}) do
    dynamic(
      [task: t, scan: s],
      t.status == :pending and t.updated_at < ^before and
        (t.kind == :scan or
           (s.status not in ^Rules.open_statuses() and s.finished_at < ^before))
    )
  end

  # Job vivo da tarefa: mesmo worker do tipo, `page_id` nos args e estado não final.
  defp live_jobs_query do
    worker_match =
      Enum.reduce(@task_workers, dynamic(false), fn {kind, worker}, acc ->
        name = Oban.Worker.to_string(worker)
        dynamic([j], ^acc or (j.worker == ^name and parent_as(:task).kind == ^kind))
      end)

    from j in Oban.Job,
      where: j.state in ^@live_job_states,
      where: ^worker_match,
      where:
        fragment(
          "? @> jsonb_build_object('page_id', ?::text)",
          j.args,
          parent_as(:task).page_id
        ),
      select: 1
  end

  defp reconcile_task({task_id, page_id}, criteria) do
    Repo.transact(fn ->
      with {:ok, audit, page, tasks} <- lock_chain(page_id),
           %PageTask{} = task <- Enum.find(tasks, &(&1.id == task_id)),
           true <- stale?(task, tasks, criteria) do
        resolve_stale(audit, page, tasks, task, criteria)
      else
        _not_stale -> {:ok, :unchanged}
      end
    end)
    |> case do
      {:ok, result} ->
        result

      {:error, reason} ->
        Logger.error("reconciliação: tarefa #{task_id}: #{inspect(reason)}")
        :error
    end
  end

  defp stale?(%PageTask{status: :running} = task, _tasks, criteria),
    do: DateTime.before?(task.started_at, Map.fetch!(criteria.running_before, task.kind))

  defp stale?(%PageTask{status: :pending, kind: :scan} = task, _tasks, criteria),
    do: DateTime.before?(task.updated_at, criteria.pending_before)

  defp stale?(%PageTask{status: :pending} = task, tasks, criteria) do
    scan = Enum.find(tasks, &(&1.kind == :scan))

    not Rules.open?(scan) and DateTime.before?(scan.finished_at, criteria.pending_before) and
      DateTime.before?(task.updated_at, criteria.pending_before)
  end

  defp stale?(_finished, _tasks, _criteria), do: false

  defp resolve_stale(audit, page, tasks, task, criteria) do
    with {:ok, worker} <- Map.fetch(@task_workers, task.kind),
         job = worker.new(%{"page_id" => task.page_id}),
         true <- requeue_allowed?(task, job, criteria) do
      requeue(page, tasks, task, job)
    else
      _no_job_or_exhausted -> fail_stale(audit, page, tasks, task, criteria.now)
    end
  end

  defp requeue_allowed?(%PageTask{requeues: requeues}, _job, %{max_requeues: max})
       when requeues >= max,
       do: false

  defp requeue_allowed?(%PageTask{status: :running, attempt: attempt}, job, _criteria),
    do: attempt < Ecto.Changeset.get_field(job, :max_attempts)

  defp requeue_allowed?(%PageTask{status: :pending}, _job, _criteria), do: true

  # O job entra antes de a tarefa mudar: se já existe um vivo (a chave única acusa conflito),
  # nada muda. A página só volta a `queued` com um job novo de fato.
  defp requeue(page, tasks, task, job) do
    case Oban.insert(job) do
      {:ok, %Oban.Job{conflict?: true}} ->
        {:ok, :unchanged}

      {:ok, _job} ->
        with {:ok, task} <-
               update_task(task, %{status: :pending, requeues: task.requeues + 1}),
             {:ok, _page} <- refresh_page(page, replace(tasks, task)) do
          Logger.warning(
            "reconciliação: tarefa #{task.kind} da página #{page.id} reenfileirada " <>
              "(#{task.requeues}ª vez)"
          )

          {:ok, :requeued}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp fail_stale(audit, page, tasks, task, now) do
    with {:ok, _page} <- fail_locked(audit, page, tasks, task, "stale", now) do
      Logger.warning("reconciliação: tarefa #{task.kind} da página #{page.id} presa, fechada")
      {:ok, :failed}
    end
  end

  ## Gravação do scan

  defp save_scan(page_id, result, axe) do
    now = now()

    with {:ok, audit, page, tasks} <- lock_chain(page_id),
         {:ok, task} <- fetch_open_task(tasks, :scan),
         {:ok, task} <- update_task(task, %{status: :done, error: nil, finished_at: now}),
         {:ok, page} <- refresh_page(page, replace(tasks, task), scan_attrs(result, axe, now)),
         {_deleted, _} <- Repo.delete_all(axe_findings_query(page.id)),
         {:ok, _count} <- insert_findings(page, axe, now),
         {:ok, _audit} <- settle(audit, now) do
      {:ok, page}
    end
  end

  defp scan_attrs(result, axe, now) do
    %{
      final_url: result["final_url"],
      http_status: result["http_status"],
      title: PageData.truncate_bytes(result["title"], @title_max_bytes),
      axe_version: axe["version"],
      scanned_at: now
    }
  end

  defp axe_findings_query(page_id) do
    from f in Finding, where: f.page_id == ^page_id and f.source == :axe
  end

  # Valida cada achado pelo changeset e grava em lotes. Um achado inválido desfaz a transação.
  defp insert_findings(page, axe, now) do
    axe
    |> AxeMapper.to_findings()
    |> Enum.reduce_while({:ok, []}, fn attrs, {:ok, rows} ->
      attrs = Map.merge(attrs, %{page_id: page.id, audit_id: page.audit_id})

      case Ecto.Changeset.apply_action(Finding.changeset(%Finding{}, attrs), :insert) do
        {:ok, finding} -> {:cont, {:ok, [row(finding, now) | rows]}}
        {:error, changeset} -> {:halt, {:error, changeset}}
      end
    end)
    |> case do
      {:ok, rows} ->
        rows
        |> Enum.reverse()
        |> Enum.chunk_every(@insert_chunk_size)
        |> Enum.reduce({:ok, 0}, fn chunk, {:ok, total} ->
          {inserted, _} = Repo.insert_all(Finding, chunk)
          {:ok, total + inserted}
        end)

      error ->
        error
    end
  end

  defp row(%Finding{} = finding, now) do
    finding
    |> Map.take(Finding.__schema__(:fields))
    |> Map.merge(%{id: Ecto.UUID.generate(), inserted_at: now, updated_at: now})
  end

  ## Falha, página e regra de conclusão (sempre com a auditoria, a página e as tarefas travadas)

  defp fail_locked(audit, page, tasks, task, error, now) do
    with {:ok, tasks} <- close_failed(tasks, task, error, now),
         {:ok, page} <- refresh_page(page, tasks),
         {:ok, _audit} <- settle(audit, now, page) do
      {:ok, page}
    end
  end

  # O `scan` que falha leva junto as tarefas abertas da página: elas dependem dos dados dele.
  defp close_failed(tasks, failed, error, now) do
    tasks
    |> Enum.reduce_while({:ok, []}, fn task, {:ok, acc} ->
      result =
        cond do
          task.id == failed.id -> close_as_failed(task, error, now)
          failed.kind == :scan and Rules.open?(task) -> close_as_failed(task, "scan_failed", now)
          true -> {:ok, task}
        end

      case result do
        {:ok, task} -> {:cont, {:ok, [task | acc]}}
        error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, closed} -> {:ok, Enum.reverse(closed)}
      error -> error
    end
  end

  defp close_as_failed(task, error, now),
    do: update_task(task, %{status: :failed, error: error, finished_at: now})

  defp update_task(task, attrs), do: Repo.update(PageTask.transition_changeset(task, attrs))

  # Grava o estado derivado das tarefas (e os fatos do scan, quando há). `error` da página é o
  # do `scan` quando ela falhou.
  defp refresh_page(page, tasks, attrs \\ %{}) do
    status = Rules.page_status(tasks)
    error = if status == :failed, do: Enum.find(tasks, &(&1.kind == :scan)).error

    page
    |> Page.progress_changeset(Map.merge(attrs, %{status: status, error: error}))
    |> Repo.update()
  end

  # Regra de conclusão. Recebe a auditoria travada e fora de estado final; recalcula os
  # contadores a partir das páginas (repetir não conta duas vezes) e encerra a auditoria quando
  # não há tarefa aberta: `completed` se ao menos uma página terminou `done`, `failed` se
  # nenhuma. O erro da auditoria `failed` é o da página que acabou de falhar (`closing`), a
  # última; sem ela, o da página falha mais recente. Não consulta o Oban.
  defp settle(%Audit{} = audit, now, closing \\ nil) do
    open_tasks =
      Repo.aggregate(
        from(t in PageTask,
          where: t.audit_id == ^audit.id and t.status in ^Rules.open_statuses()
        ),
        :count
      )

    counts =
      from(p in Page,
        where: p.audit_id == ^audit.id,
        group_by: p.status,
        select: {p.status, count()}
      )
      |> Repo.all()
      |> Map.new()

    done = Map.get(counts, :done, 0)

    counters = %{
      pages_found: counts |> Map.values() |> Enum.sum(),
      pages_scanned: done + Map.get(counts, :analyzing, 0),
      pages_failed: Map.get(counts, :failed, 0)
    }

    final =
      case Rules.audit_outcome(%{open_tasks: open_tasks, pages_done: done}) do
        :open -> %{}
        :completed -> %{status: :completed, error: nil, finished_at: now}
        :failed -> %{status: :failed, error: failed_error(audit, closing), finished_at: now}
      end

    audit
    |> Audit.progress_changeset(Map.merge(counters, final))
    |> Repo.update()
  end

  defp failed_error(_audit, %Page{status: :failed, error: error}), do: error

  defp failed_error(audit, _closing) do
    Repo.one(
      from p in Page,
        where: p.audit_id == ^audit.id and p.status == :failed,
        order_by: [desc: p.updated_at, desc: p.id],
        limit: 1,
        select: p.error
    )
  end

  ## Travas

  # Trava a auditoria, a página e as tarefas da página, nessa ordem. O `audit_id` da página
  # não muda, então é lido sem trava só para saber qual auditoria travar primeiro.
  defp lock_chain(page_id) do
    with {:ok, uuid} <- Ecto.UUID.cast(page_id),
         audit_id when is_binary(audit_id) <-
           Repo.one(from p in Page, where: p.id == ^uuid, select: p.audit_id),
         {:ok, audit} <- lock_audit(audit_id),
         %Page{} = page <- Repo.one(from p in Page, where: p.id == ^uuid, lock: "FOR UPDATE") do
      tasks =
        Repo.all(
          from t in PageTask, where: t.page_id == ^uuid, order_by: t.id, lock: "FOR UPDATE"
        )

      {:ok, audit, page, tasks}
    else
      {:error, :already_finished} -> {:error, :already_finished}
      _not_found -> {:error, :page_not_found}
    end
  end

  # A única trava de auditoria: `FOR UPDATE` e recusa de estado final.
  defp lock_audit(audit_id) do
    with {:ok, uuid} <- Ecto.UUID.cast(audit_id),
         %Audit{} = audit <- Repo.one(from a in Audit, where: a.id == ^uuid, lock: "FOR UPDATE") do
      if audit.status in Audit.final_statuses(),
        do: {:error, :already_finished},
        else: {:ok, audit}
    else
      _not_found -> {:error, :audit_not_found}
    end
  end

  # Com a auditoria travada, contar e procurar a URL não tem corrida.
  defp check_new_page(audit, url) do
    pages = from p in Page, where: p.audit_id == ^audit.id

    cond do
      Repo.exists?(where(pages, [p], p.url == ^url)) -> {:error, :duplicate_url}
      Repo.aggregate(pages, :count) >= audit.page_limit -> {:error, :page_limit_reached}
      true -> :ok
    end
  end

  defp check_page_open(%Page{} = page),
    do: if(Rules.page_finished?(page), do: {:error, :already_finished}, else: :ok)

  defp check_scan_finished(_tasks, :scan), do: :ok

  defp check_scan_finished(tasks, _kind) do
    if tasks |> Enum.find(&(&1.kind == :scan)) |> Rules.open?(),
      do: {:error, :scan_not_finished},
      else: :ok
  end

  defp check_new_kind(tasks, kind) do
    if Enum.any?(tasks, &(&1.kind == kind)), do: {:error, :duplicate_task}, else: :ok
  end

  defp fetch_open_task(tasks, kind) do
    case Enum.find(tasks, &(&1.kind == kind)) do
      nil ->
        {:error, :task_not_found}

      %PageTask{} = task ->
        if Rules.open?(task), do: {:ok, task}, else: {:error, :already_finished}
    end
  end

  defp replace(tasks, %PageTask{id: id} = task),
    do: Enum.map(tasks, fn current -> if current.id == id, do: task, else: current end)

  defp now, do: DateTime.utc_now(:second)
end
