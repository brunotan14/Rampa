defmodule Rampa.Audits do
  @moduledoc """
  Auditorias, páginas, tarefas e achados (PRD §8) e o ciclo de vida deles
  (regras em `Rampa.Audits.Rules`).

  ## Criação

  `create_audit/3` é o único ponto de entrada de uma auditoria nova (`POST /api/audits`). Ela
  mesma passa a URL pelo `Rampa.Security.URLGuard` (RF-RA001, RF-RA002), como
  `add_page/2`: não existe caminho que crie auditoria ou página sem a proteção contra SSRF.
  O limite de taxa e o teto diário ficam em `Rampa.Audits.Limits`.

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

  alias Rampa.Audits.{
    Audit,
    AxeMapper,
    Finding,
    Limits,
    Page,
    PageData,
    PageTask,
    Rules,
    ScanPageJob
  }

  alias Rampa.Repo
  alias Rampa.Security.URLGuard

  # Limite de parâmetros do PostgreSQL (65 535) dividido pelas colunas de `findings`, com folga.
  @insert_chunk_size 1_000

  # O título vem da página: guardar só o necessário para identificá-la.
  @title_max_bytes 512

  # Tipo de tarefa → job que a executa (args: `%{"page_id" => id}`). As análises de IA ganham
  # job no M4; até lá, uma tarefa delas presa é fechada como falha pela reconciliação.
  @task_workers %{scan: ScanPageJob}

  # M1 (RF-RA001): toda auditoria tem uma página só. O M5 libera o `page_limit` pedido.
  @m1_page_limit 1
  @page_limit_range 1..25

  # `Idempotency-Key`: de 1 a 128 caracteres ASCII visíveis; vale por 24 h.
  @idempotency_key ~r/\A[\x21-\x7E]{1,128}\z/
  @idempotency_ttl_seconds 86_400

  # Paginação dos achados.
  @findings_default_limit 50
  @findings_max_limit 100

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

  @type requester :: %{required(:ip_hash) => String.t()}
  @type create_error ::
          URLGuard.reason()
          | :invalid_page_limit
          | :invalid_idempotency_key
          | {:rate_limited, DateTime.t()}
          | {:daily_limit_reached, DateTime.t()}
          | :idempotency_key_reused
          | :idempotency_conflict

  ## Criação de auditorias

  @doc """
  Cria uma auditoria `queued` para `raw_url` com a primeira página, a tarefa `scan` e o
  `ScanPageJob`, numa transação só (PRD §7, passo 1). Devolve a auditoria.

  `requester` identifica quem pede, só pelo hash do IP (`%{ip_hash: ...}`,
  `Rampa.Security.IPHash`).

  Opções:

    * `:page_limit`: o limite pedido. Se vier, tem de ser um inteiro de 1 a 25, senão
      `{:error, :invalid_page_limit}`. **No M1 a auditoria é sempre criada com
      `page_limit = 1`** (RF-RA001); o M5 passa a usar o valor pedido;
    * `:idempotency_key`: o cabeçalho `Idempotency-Key`, de 1 a 128 caracteres ASCII
      visíveis (senão `{:error, :invalid_idempotency_key}`). A mesma chave do mesmo
      solicitante em até 24 h, com a mesma URL **depois de normalizada**, devolve a
      auditoria já criada, sem criar outra nem contar no limite; com outra URL, devolve
      `{:error, :idempotency_key_reused}`. O `page_limit` não entra na comparação no M1,
      porque o valor pedido não é guardado (toda auditoria tem uma página); quando o M5
      guardar o valor pedido, ele passa a ser comparado também. Depois de 24 h a chave é
      liberada e a próxima requisição cria uma auditoria nova;
    * `:limits`: sobrescreve `:per_ip_per_hour` e `:daily` (`Rampa.Audits.Limits.config/1`);
    * `:now`: fixa o relógio (testes).

  Ordem: a forma da requisição (`page_limit`, chave, URL normalizada sem DNS) é conferida
  primeiro; uma chave já usada é resolvida sem consultar o DNS. Depois a URL passa pelo
  `URLGuard` (com o DNS) **fora da transação**, e só então a transação abre e toma as
  travas consultivas (`Rampa.Audits.Limits`: solicitante, depois global). **Com as duas
  travas**, o relógio é lido (`inserted_at` da auditoria e base da janela e do dia), a
  chave é procurada de novo e os limites são contados: por hora
  (`{:error, {:rate_limited, retry_at}}`) e do dia (`{:error, {:daily_limit_reached,
  retry_at}}`). `retry_at` é o horário a partir do qual dá para tentar de novo, em UTC.

  Recusas da URL: as de `Rampa.Security.URLGuard.validate/2`.
  """
  @spec create_audit(String.t(), requester(), keyword()) ::
          {:ok, Audit.t()} | {:error, create_error() | Ecto.Changeset.t()}
  def create_audit(raw_url, %{ip_hash: ip_hash}, opts \\ []) when is_binary(ip_hash) do
    key = Keyword.get(opts, :idempotency_key)
    clock = fn -> opts |> Keyword.get_lazy(:now, &now/0) |> DateTime.truncate(:second) end
    request = %{ip_hash: ip_hash, key: key}

    with :ok <- check_page_limit(Keyword.get(opts, :page_limit)),
         :ok <- check_idempotency_key(key),
         {:ok, normalized} <- URLGuard.normalize(raw_url) do
      case find_idempotent(ip_hash, key, clock.()) do
        %Audit{} = audit -> replay(audit, normalized)
        nil -> validate_and_insert(raw_url, request, opts, clock)
      end
    end
  end

  # A chave já usada só devolve a auditoria se a URL normalizada é a mesma.
  defp replay(%Audit{start_url: url} = audit, url), do: {:ok, audit}
  defp replay(%Audit{}, _other_url), do: {:error, :idempotency_key_reused}

  # O DNS do `URLGuard` roda aqui, fora da transação e antes das travas.
  defp validate_and_insert(raw_url, request, opts, clock) do
    with {:ok, url} <- URLGuard.validate(raw_url) do
      limits = Limits.config(Keyword.get(opts, :limits, []))
      insert_audit(Map.put(request, :url, url), limits, clock)
    end
  end

  defp check_page_limit(nil), do: :ok
  defp check_page_limit(limit) when is_integer(limit) and limit in @page_limit_range, do: :ok
  defp check_page_limit(_invalid), do: {:error, :invalid_page_limit}

  defp check_idempotency_key(nil), do: :ok

  defp check_idempotency_key(key) when is_binary(key) do
    if Regex.match?(@idempotency_key, key), do: :ok, else: {:error, :invalid_idempotency_key}
  end

  defp check_idempotency_key(_invalid), do: {:error, :invalid_idempotency_key}

  # As duas travas vêm antes de qualquer leitura ou escrita: nenhuma trava de linha é
  # segurada enquanto se espera trava consultiva (ver `Rampa.Audits.Limits`).
  defp insert_audit(request, limits, clock) do
    Repo.transact(fn ->
      :ok = Limits.lock_requester(request.ip_hash)
      :ok = Limits.lock_global()
      now = clock.()

      case claim_idempotency_key(request.ip_hash, request.key, now) do
        %Audit{} = audit -> replay(audit, request.url)
        nil -> insert_within_limits(request, limits, now)
      end
    end)
    |> case do
      # Conflito no índice único da chave: outra requisição com a mesma chave ganhou. Não
      # acontece com a trava do solicitante, mas o índice é a última palavra.
      {:error, :idempotency_conflict} -> idempotent_winner(request, clock.())
      result -> result
    end
  end

  defp idempotent_winner(request, now) do
    case find_idempotent(request.ip_hash, request.key, now) do
      %Audit{} = audit -> replay(audit, request.url)
      nil -> {:error, :idempotency_conflict}
    end
  end

  defp insert_within_limits(request, limits, now) do
    attrs = %{
      start_url: request.url,
      page_limit: @m1_page_limit,
      requester_ip_hash: request.ip_hash,
      idempotency_key: request.key
    }

    changeset =
      attrs
      |> Audit.create_changeset()
      |> Ecto.Changeset.change(inserted_at: now, updated_at: now)

    with :ok <- Limits.check_hourly(request.ip_hash, limits.per_ip_per_hour, now),
         :ok <- Limits.check_daily(limits.daily, now),
         {:ok, audit} <- insert_new_audit(changeset),
         {:ok, _page, audit} <- append_page(audit, request.url, now) do
      {:ok, audit}
    end
  end

  defp insert_new_audit(changeset) do
    case Repo.insert(changeset) do
      {:ok, audit} ->
        {:ok, audit}

      {:error, %Ecto.Changeset{errors: errors} = changeset} ->
        if Keyword.has_key?(errors, :idempotency_key),
          do: {:error, :idempotency_conflict},
          else: {:error, changeset}
    end
  end

  # Auditoria da chave ainda válida (até 24 h), sem trava.
  defp find_idempotent(_ip_hash, nil, _now), do: nil

  defp find_idempotent(ip_hash, key, now) do
    Repo.one(
      from a in idempotency_query(ip_hash, key),
        where: a.inserted_at > ^DateTime.add(now, -@idempotency_ttl_seconds)
    )
  end

  # Com as duas travas: devolve a auditoria da chave ainda válida; se a chave venceu,
  # libera-a na auditoria antiga para a nova poder usá-la. O `UPDATE` trava a linha antiga,
  # mas só depois das travas consultivas, nunca antes de esperar por elas.
  defp claim_idempotency_key(_ip_hash, nil, _now), do: nil

  defp claim_idempotency_key(ip_hash, key, now) do
    case find_idempotent(ip_hash, key, now) do
      %Audit{} = audit ->
        audit

      nil ->
        Repo.update_all(idempotency_query(ip_hash, key), set: [idempotency_key: nil])
        nil
    end
  end

  defp idempotency_query(ip_hash, key) do
    from a in Audit, where: a.requester_ip_hash == ^ip_hash and a.idempotency_key == ^key
  end

  ## Consulta

  @type severity_totals :: %{Finding.severity() => non_neg_integer()}
  @type summary :: %{
          audit: Audit.t(),
          totals_by_severity: severity_totals(),
          needs_review_count: non_neg_integer()
        }

  @doc """
  Resumo de uma auditoria (`GET /api/audits/:id`, mínimo do M1): a auditoria, os totais
  por severidade **só dos achados confirmados** (`needs_review = false`) e quantos achados
  pedem revisão. UUID inválido ou inexistente: `{:error, :audit_not_found}`.
  """
  @spec get_audit_summary(String.t()) :: {:ok, summary()} | {:error, :audit_not_found}
  def get_audit_summary(id) do
    with {:ok, audit} <- fetch_audit(id) do
      counts =
        from(f in Finding,
          where: f.audit_id == ^audit.id,
          group_by: [f.needs_review, f.severity],
          select: {f.needs_review, f.severity, count()}
        )
        |> Repo.all()

      totals =
        for {false, severity, count} <- counts,
            reduce: Map.new(Finding.severities(), &{&1, 0}),
            do: (acc -> Map.put(acc, severity, count))

      needs_review = for {true, _severity, count} <- counts, reduce: 0, do: (acc -> acc + count)

      {:ok, %{audit: audit, totals_by_severity: totals, needs_review_count: needs_review}}
    end
  end

  @type findings_page :: %{data: [Finding.t()], next_cursor: String.t() | nil}

  @doc """
  Achados de uma auditoria (`GET /api/audits/:id/findings`), em páginas, na ordem
  `(inserted_at, id)`.

  `params` são os parâmetros da requisição (chaves em texto), todos opcionais:

    * `"severity"` (`critical`, `serious`, `moderate`, `minor`), `"source"` (`axe`, `ai`,
      `heuristic`) e `"needs_review"` (`true`, `false`): valor fora disso devolve
      `{:error, :invalid_filter}`;
    * `"limit"`: de 1 a #{@findings_max_limit}, padrão #{@findings_default_limit}
      (`{:error, :invalid_limit}`);
    * `"cursor"`: o `next_cursor` da página anterior, opaco (`{:error, :invalid_cursor}`).

  Paginação por chave (keyset) em `(inserted_at, id)`, com `inserted_at` em microssegundos:
  nada se repete nem é pulado. É **estável depois que a auditoria termina**. Durante a
  auditoria, um achado novo pode aparecer fora de ordem: o `inserted_at` é o horário da
  transação que grava a página, e uma transação que começou antes pode terminar depois de
  a lista já ter passado pelo horário dela.

  `next_cursor` é `nil` na última página. Auditoria inexistente: `{:error, :audit_not_found}`.
  """
  @spec list_findings(String.t(), map()) ::
          {:ok, findings_page()}
          | {:error, :audit_not_found | :invalid_filter | :invalid_limit | :invalid_cursor}
  def list_findings(audit_id, params) when is_map(params) do
    with {:ok, audit} <- fetch_audit(audit_id),
         {:ok, filters} <- findings_filters(params),
         {:ok, limit} <- findings_limit(params["limit"]),
         {:ok, after_key} <- decode_cursor(params["cursor"]) do
      rows =
        from(f in Finding,
          where: f.audit_id == ^audit.id,
          where: ^filters,
          order_by: [asc: f.inserted_at, asc: f.id],
          limit: ^(limit + 1)
        )
        |> after_cursor(after_key)
        |> Repo.all()

      {data, rest} = Enum.split(rows, limit)
      next_cursor = if rest == [], do: nil, else: encode_cursor(List.last(data))

      {:ok, %{data: data, next_cursor: next_cursor}}
    end
  end

  defp fetch_audit(id) do
    with {:ok, uuid} <- Ecto.UUID.cast(id),
         %Audit{} = audit <- Repo.get(Audit, uuid) do
      {:ok, audit}
    else
      _not_found -> {:error, :audit_not_found}
    end
  end

  defp findings_filters(params) do
    [
      {"severity", :severity, Map.new(Finding.severities(), &{Atom.to_string(&1), &1})},
      {"source", :source, Map.new(Finding.sources(), &{Atom.to_string(&1), &1})},
      {"needs_review", :needs_review, %{"true" => true, "false" => false}}
    ]
    |> Enum.reduce_while({:ok, dynamic(true)}, fn filter, {:ok, acc} ->
      case add_filter(acc, filter, params) do
        {:ok, acc} -> {:cont, {:ok, acc}}
        :error -> {:halt, {:error, :invalid_filter}}
      end
    end)
  end

  defp add_filter(acc, {param, field, values}, params) do
    with {:ok, raw} <- Map.fetch(params, param),
         {:ok, value} <- Map.fetch(values, raw) do
      {:ok, dynamic([f], ^acc and field(f, ^field) == ^value)}
    else
      :error -> if Map.has_key?(params, param), do: :error, else: {:ok, acc}
    end
  end

  defp findings_limit(nil), do: {:ok, @findings_default_limit}

  defp findings_limit(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {limit, ""} when limit in 1..@findings_max_limit -> {:ok, limit}
      _invalid -> {:error, :invalid_limit}
    end
  end

  defp findings_limit(_invalid), do: {:error, :invalid_limit}

  # Cursor: `<inserted_at em microssegundos Unix>:<id>` em Base64 de URL, sem
  # preenchimento. O cliente não precisa (nem deve) interpretar.
  defp encode_cursor(%Finding{inserted_at: inserted_at, id: id}),
    do:
      Base.url_encode64("#{DateTime.to_unix(inserted_at, :microsecond)}:#{id}",
        padding: false
      )

  defp decode_cursor(nil), do: {:ok, nil}

  defp decode_cursor(cursor) when is_binary(cursor) do
    with {:ok, decoded} <- Base.url_decode64(cursor, padding: false),
         [unix, id] <- String.split(decoded, ":"),
         {unix, ""} <- Integer.parse(unix),
         {:ok, inserted_at} <- DateTime.from_unix(unix, :microsecond),
         {:ok, id} <- Ecto.UUID.cast(id) do
      {:ok, {inserted_at, id}}
    else
      _invalid -> {:error, :invalid_cursor}
    end
  end

  defp decode_cursor(_invalid), do: {:error, :invalid_cursor}

  defp after_cursor(query, nil), do: query

  defp after_cursor(query, {inserted_at, id}) do
    where(
      query,
      [f],
      f.inserted_at > ^inserted_at or (f.inserted_at == ^inserted_at and f.id > ^id)
    )
  end

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
         {:ok, page, _audit} <- append_page(audit, url, now()) do
      {:ok, page}
    end
  end

  # Página `queued`, tarefa `scan` `pending` e `ScanPageJob`, com a regra de conclusão.
  # Recebe a auditoria travada (ou recém-criada na mesma transação) e a URL já validada pelo
  # `URLGuard`. Usada por `add_page/2` e `create_audit/3`. Devolve a página e a auditoria
  # com os contadores atualizados.
  defp append_page(audit, url, now) do
    with :ok <- check_new_page(audit, url),
         {:ok, page} <- Repo.insert(Page.create_changeset(audit, url)),
         {:ok, _task} <- Repo.insert(PageTask.create_changeset(page, %{kind: :scan})),
         {:ok, _job} <- Oban.insert(ScanPageJob.new(%{"page_id" => page.id})),
         {:ok, audit} <- settle(audit, now) do
      {:ok, page, audit}
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

  Espera um resultado que já passou pelo schema do contrato
  (`Rampa.Scanner.Contract`, conferido em `Rampa.Scanner.HTTP`). Ele é saneado antes
  (`Rampa.Audits.PageData`): sem NUL e com o título cortado em #{@title_max_bytes} bytes.
  Como defesa para quem chama sem passar pelo cliente, resultado sem o campo `axe` devolve
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
         {:ok, _count} <- insert_findings(page, axe, DateTime.utc_now()),
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
