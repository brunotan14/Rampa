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

  ## Andamento e eventos (RF-RA004)

  Toda escrita que muda um campo do `progress` da auditoria (status, contadores, erro,
  achados) passa por um ponto único, `commit_progress`, com a auditoria travada: ele sobe a
  `revision` (sempre, mesmo sem outra mudança), grava e deriva os eventos do diff de estado
  (`Rampa.Audits.Events.diff/4`). Só se houver evento ele lê o snapshot (`revision` e
  `progress`), na mesma transação. Reenfileirar uma tarefa (reconciliação) não muda nenhum
  campo do `progress` e não sobe a `revision`.

  A transação devolve os eventos junto com o resultado, e eles são publicados
  (`Rampa.Audits.Events.publish/1`) **só depois do commit**: transação desfeita não publica
  nada. `publish/1` levanta `ArgumentError` dentro de uma transação, de propósito: chamar uma
  transição pública destas dentro de outra transação é **erro de uso**, porque o commit
  interno seria só um savepoint e os eventos sairiam antes do commit de verdade.

  O snapshot (`get_progress/1`, `get_audit_summary/1` e o de cada evento) é lido numa
  instrução SQL só, com a linha da auditoria e os agregados dos achados juntos: nunca sai
  `revision` N+1 com os totais de N.
  """

  import Ecto.Query

  require Logger

  alias Rampa.Audits.{
    Audit,
    AxeMapper,
    Events,
    Finding,
    Limits,
    Page,
    PageData,
    PageTask,
    Report,
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
    transact_and_publish(fn ->
      :ok = Limits.lock_requester(request.ip_hash)
      :ok = Limits.lock_global()
      now = clock.()

      case claim_idempotency_key(request.ip_hash, request.key, now) do
        %Audit{} = audit -> replay_in_transaction(audit, request.url)
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

  # A repetição idempotente não muda nada: nenhum evento a publicar.
  defp replay_in_transaction(audit, url) do
    with {:ok, audit} <- replay(audit, url), do: {:ok, {audit, []}}
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
         {:ok, _page, audit, events} <- append_page(audit, request.url, now) do
      {:ok, {audit, events}}
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

  @doc """
  Resumo de uma auditoria (`GET /api/audits/:id`, RF-RA005): a auditoria (com a `revision`),
  os totais por severidade dos achados confirmados (`needs_review = false`) e dos que pedem
  revisão, quantos pedem revisão e o top 5 das regras confirmadas. Tudo numa instrução só
  (`Rampa.Audits.Report.summary/1`): a `revision` e os totais são do mesmo instante. UUID
  inválido ou inexistente: `{:error, :audit_not_found}`.
  """
  @spec get_audit_summary(String.t()) :: {:ok, Report.summary()} | {:error, :audit_not_found}
  defdelegate get_audit_summary(id), to: Report, as: :summary

  @doc "Páginas da auditoria com as contagens (RF-RA006). Ver `Rampa.Audits.Report.list_pages/1`."
  @spec list_pages(String.t()) :: {:ok, [Report.page_summary()]} | {:error, :audit_not_found}
  defdelegate list_pages(audit_id), to: Report

  @doc "Uma página com as regras aprovadas (RF-RA017). Ver `Rampa.Audits.Report.get_page/2`."
  @spec get_page(String.t(), String.t()) ::
          {:ok, Report.page_summary()} | {:error, :audit_not_found | :page_not_found}
  defdelegate get_page(audit_id, page_id), to: Report

  @doc "Detalhe de um achado (RF-RA007). Ver `Rampa.Audits.Report.get_finding/2`."
  @spec get_finding(String.t(), String.t()) ::
          {:ok, Report.finding_detail()} | {:error, :audit_not_found | :finding_not_found}
  defdelegate get_finding(audit_id, finding_id), to: Report

  @doc """
  Andamento atual de uma auditoria, para o join do canal `audit:<id>` (RF-RA004): a
  `revision` e o `progress` absoluto (`Rampa.Audits.Events.progress/0`), lidos numa
  instrução só. UUID inválido ou inexistente: `{:error, :audit_not_found}`.
  """
  @spec get_progress(String.t()) :: {:ok, Events.snapshot()} | {:error, :audit_not_found}
  def get_progress(id) do
    with {:ok, audit, totals, needs_review} <- read_snapshot(id) do
      {:ok, %{revision: audit.revision, progress: progress(audit, totals, needs_review)}}
    end
  end

  # A linha da auditoria e os agregados dos achados numa instrução SQL só: no `READ
  # COMMITTED`, uma instrução enxerga um único instante, então a `revision` nunca vem de um
  # commit e os totais de outro. Dentro de uma transação, enxerga as próprias escritas.
  defp read_snapshot(id) do
    with {:ok, uuid} <- Ecto.UUID.cast(id),
         {%Audit{} = audit, counts} <- Repo.one(snapshot_query(uuid)) do
      {totals, needs_review} = split_counts(counts)
      {:ok, audit, totals, needs_review}
    else
      _not_found -> {:error, :audit_not_found}
    end
  end

  # A auditoria e as contagens dos achados dela, na mesma instrução (`finding_counts/2` como
  # subconsulta: um agregado sem `GROUP BY` devolve sempre uma linha, zerada sem achados).
  defp snapshot_query(audit_id) do
    from a in Audit,
      cross_join: c in subquery(finding_counts(:audit_id, audit_id)),
      where: a.id == ^audit_id,
      select: {a, c}
  end

  # A única contagem de achados do andamento, por auditoria (`:audit_id`) ou por página
  # (`:page_id`): confirmados (`needs_review = false`) por severidade e os que pedem
  # revisão. Usada pelo snapshot e pelo `page_scanned`, para os dois nunca divergirem.
  defp finding_counts(scope, id) when scope in [:audit_id, :page_id] do
    from f in Finding,
      where: field(f, ^scope) == ^id,
      select: %{
        critical: filter(count(f.id), f.severity == :critical and not f.needs_review),
        serious: filter(count(f.id), f.severity == :serious and not f.needs_review),
        moderate: filter(count(f.id), f.severity == :moderate and not f.needs_review),
        minor: filter(count(f.id), f.severity == :minor and not f.needs_review),
        needs_review: filter(count(f.id), f.needs_review)
      }
  end

  defp split_counts(%{needs_review: needs_review} = counts),
    do: {Map.delete(counts, :needs_review), needs_review}

  defp progress(%Audit{} = audit, totals, needs_review) do
    %{
      status: audit.status,
      pages_found: audit.pages_found,
      pages_scanned: audit.pages_scanned,
      pages_failed: audit.pages_failed,
      totals_by_severity: totals,
      needs_review_count: needs_review,
      error: audit.error
    }
  end

  @type findings_page :: %{
          data: [Finding.t()],
          next_cursor: String.t() | nil,
          total: non_neg_integer()
        }

  @doc """
  Achados de uma auditoria (`GET /api/audits/:id/findings`), em páginas.

  `params` são os parâmetros da requisição (chaves em texto), todos opcionais:

    * `"severity"` (`critical`, `serious`, `moderate`, `minor`), `"source"` (`axe`, `ai`,
      `heuristic`), `"needs_review"` (`true`, `false`), `"page_id"` (UUID; página de outra
      auditoria dá lista vazia) e `"wcag"` (critério no formato `1.4.3`): valor fora disso
      devolve `{:error, :invalid_filter}`;
    * `"sort"`: `recorded` (padrão, ordem `(inserted_at, id)`) ou `severity` (mais grave
      primeiro, depois `rule_id`, `inserted_at` e `id`: os achados da mesma regra ficam
      juntos). Outro valor: `{:error, :invalid_sort}`;
    * `"limit"`: de 1 a #{@findings_max_limit}, padrão #{@findings_default_limit}
      (`{:error, :invalid_limit}`);
    * `"cursor"`: o `next_cursor` da página anterior, opaco, da mesma ordem
      (`{:error, :invalid_cursor}`).

  Paginação por chave (keyset), sem repetir nem pular nada; **estável depois que a auditoria
  termina**. Durante a auditoria, um achado novo pode aparecer fora de ordem: o
  `inserted_at` é o horário da transação que grava a página, e uma transação que começou
  antes pode terminar depois de a lista já ter passado pelo horário dela.

    * `recorded`: o cursor leva `(inserted_at em microssegundos, id)`;
    * `severity`: o cursor leva só o id do último achado (a âncora), e a chave
      `(severity_rank, rule_id, inserted_at, id)` é lida do banco, da âncora da mesma
      auditoria: o `rule_id` vem da página auditada e não entra no cursor. Âncora que não
      existe (apagada por uma nova varredura durante a auditoria) ou de outra auditoria:
      `{:error, :invalid_cursor}`.

  `next_cursor` é `nil` na última página; `total` é quantos achados passam nos filtros (sem
  o cursor). Auditoria inexistente: `{:error, :audit_not_found}`.
  """
  @spec list_findings(String.t(), map()) ::
          {:ok, findings_page()}
          | {:error,
             :audit_not_found
             | :invalid_filter
             | :invalid_sort
             | :invalid_limit
             | :invalid_cursor}
  def list_findings(audit_id, params) when is_map(params) do
    with {:ok, audit} <- fetch_audit(audit_id),
         {:ok, filters} <- findings_filters(params),
         {:ok, sort} <- findings_sort(params["sort"]),
         {:ok, limit} <- findings_limit(params["limit"]),
         {:ok, after_key} <- decode_cursor(sort, params["cursor"]),
         filtered = from(f in Finding, where: f.audit_id == ^audit.id, where: ^filters),
         rows = fetch_findings_page(filtered, sort, limit, after_key, audit.id),
         :ok <- check_anchor(rows, after_key, audit.id) do
      {data, rest} = Enum.split(rows, limit)
      next_cursor = if rest == [], do: nil, else: encode_cursor(sort, List.last(data))

      {:ok, %{data: data, next_cursor: next_cursor, total: Repo.aggregate(filtered, :count)}}
    end
  end

  defp fetch_findings_page(filtered, sort, limit, after_key, audit_id) do
    filtered
    |> order_findings(sort)
    |> limit(^(limit + 1))
    |> after_cursor(after_key, audit_id)
    |> Repo.all()
  end

  defp fetch_audit(id) do
    with {:ok, uuid} <- Ecto.UUID.cast(id),
         %Audit{} = audit <- Repo.get(Audit, uuid) do
      {:ok, audit}
    else
      _not_found -> {:error, :audit_not_found}
    end
  end

  # Critério WCAG: princípio de 1 a 4, diretriz e critério com até dois dígitos.
  @wcag_criterion ~r/\A[1-4]\.\d{1,2}\.\d{1,2}\z/

  defp findings_filters(params) do
    [
      {"severity", :severity, &Map.fetch(severity_values(), &1)},
      {"source", :source, &Map.fetch(source_values(), &1)},
      {"needs_review", :needs_review, &Map.fetch(%{"true" => true, "false" => false}, &1)},
      {"page_id", :page_id, &cast_page_id/1},
      {"wcag", :wcag_criteria, &cast_wcag/1}
    ]
    |> Enum.reduce_while({:ok, dynamic(true)}, fn filter, {:ok, acc} ->
      case add_filter(acc, filter, params) do
        {:ok, acc} -> {:cont, {:ok, acc}}
        :error -> {:halt, {:error, :invalid_filter}}
      end
    end)
  end

  defp severity_values, do: Map.new(Finding.severities(), &{Atom.to_string(&1), &1})
  defp source_values, do: Map.new(Finding.sources(), &{Atom.to_string(&1), &1})

  defp cast_page_id(raw) when is_binary(raw), do: Ecto.UUID.cast(raw)
  defp cast_page_id(_invalid), do: :error

  defp cast_wcag(raw) when is_binary(raw),
    do: if(Regex.match?(@wcag_criterion, raw), do: {:ok, raw}, else: :error)

  defp cast_wcag(_invalid), do: :error

  defp add_filter(acc, {param, field, cast}, params) do
    case Map.fetch(params, param) do
      :error ->
        {:ok, acc}

      {:ok, raw} ->
        with {:ok, value} <- cast.(raw), do: {:ok, filter_on(acc, field, value)}
    end
  end

  defp filter_on(acc, :wcag_criteria, value),
    do: dynamic([f], ^acc and ^value in f.wcag_criteria)

  defp filter_on(acc, field, value), do: dynamic([f], ^acc and field(f, ^field) == ^value)

  defp findings_sort(nil), do: {:ok, :recorded}
  defp findings_sort("recorded"), do: {:ok, :recorded}
  defp findings_sort("severity"), do: {:ok, :severity}
  defp findings_sort(_invalid), do: {:error, :invalid_sort}

  defp order_findings(query, :recorded),
    do: order_by(query, [f], asc: f.inserted_at, asc: f.id)

  defp order_findings(query, :severity),
    do:
      order_by(query, [f],
        asc: f.severity_rank,
        asc: f.rule_id,
        asc: f.inserted_at,
        asc: f.id
      )

  defp findings_limit(nil), do: {:ok, @findings_default_limit}

  defp findings_limit(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {limit, ""} when limit in 1..@findings_max_limit -> {:ok, limit}
      _invalid -> {:error, :invalid_limit}
    end
  end

  defp findings_limit(_invalid), do: {:error, :invalid_limit}

  # Cursores em Base64 de URL, sem preenchimento. O cliente não precisa (nem deve)
  # interpretar:
  #
  #   * `recorded`: `<inserted_at em microssegundos Unix>:<id>`;
  #   * `severity`: `severity:<id>`, só a âncora.
  #
  # O formato de uma ordem não decodifica na outra (`severity` não é número; o número não é
  # `severity`): cursor de outra ordem é `invalid_cursor`.
  @cursor_max_bytes 256
  @severity_cursor_prefix "severity:"

  defp encode_cursor(:recorded, %Finding{inserted_at: inserted_at, id: id}),
    do:
      Base.url_encode64("#{DateTime.to_unix(inserted_at, :microsecond)}:#{id}",
        padding: false
      )

  defp encode_cursor(:severity, %Finding{id: id}),
    do: Base.url_encode64(@severity_cursor_prefix <> id, padding: false)

  defp decode_cursor(_sort, nil), do: {:ok, nil}

  defp decode_cursor(sort, cursor)
       when is_binary(cursor) and byte_size(cursor) <= @cursor_max_bytes do
    case Base.url_decode64(cursor, padding: false) do
      {:ok, decoded} -> decode_cursor_key(sort, decoded)
      :error -> {:error, :invalid_cursor}
    end
  end

  defp decode_cursor(_sort, _invalid), do: {:error, :invalid_cursor}

  defp decode_cursor_key(:severity, @severity_cursor_prefix <> id) do
    case Ecto.UUID.cast(id) do
      {:ok, id} -> {:ok, {:anchor, id}}
      :error -> {:error, :invalid_cursor}
    end
  end

  defp decode_cursor_key(:severity, _other), do: {:error, :invalid_cursor}

  defp decode_cursor_key(:recorded, decoded) do
    with [unix, id] <- String.split(decoded, ":"),
         {unix, ""} <- Integer.parse(unix),
         # Nenhum achado é anterior a 1970; antes do mínimo do `timestamptz` a consulta levantaria exceção.
         true <- unix >= 0,
         {:ok, inserted_at} <- DateTime.from_unix(unix, :microsecond),
         {:ok, id} <- Ecto.UUID.cast(id) do
      {:ok, {inserted_at, id}}
    else
      _invalid -> {:error, :invalid_cursor}
    end
  end

  defp after_cursor(query, nil, _audit_id), do: query

  defp after_cursor(query, {:anchor, id}, audit_id) do
    where(
      query,
      [f],
      fragment(
        "(?, ?, ?, ?) > (SELECT a.severity_rank, a.rule_id, a.inserted_at, a.id FROM findings AS a WHERE a.id = ? AND a.audit_id = ?)",
        f.severity_rank,
        f.rule_id,
        f.inserted_at,
        f.id,
        type(^id, Ecto.UUID),
        type(^audit_id, Ecto.UUID)
      )
    )
  end

  defp after_cursor(query, {inserted_at, id}, _audit_id) do
    where(
      query,
      [f],
      f.inserted_at > ^inserted_at or (f.inserted_at == ^inserted_at and f.id > ^id)
    )
  end

  # Âncora sem linha: a comparação dá `NULL` e a lista vem vazia. Só então confere se a
  # âncora existe nesta auditoria (a lista vazia de verdade continua vazia).
  defp check_anchor([], {:anchor, id}, audit_id) do
    if Repo.exists?(from f in Finding, where: f.id == ^id and f.audit_id == ^audit_id),
      do: :ok,
      else: {:error, :invalid_cursor}
  end

  defp check_anchor(_rows, _after_key, _audit_id), do: :ok

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
      transact_and_publish(fn -> insert_page(audit_id, url) end)
    end
  end

  defp insert_page(audit_id, url) do
    with {:ok, audit} <- lock_audit(audit_id),
         {:ok, page, _audit, events} <- append_page(audit, url, now()) do
      {:ok, {page, events}}
    end
  end

  # Página `queued`, tarefa `scan` `pending` e `ScanPageJob`, com a regra de conclusão.
  # Recebe a auditoria travada (ou recém-criada na mesma transação) e a URL já validada pelo
  # `URLGuard`. Usada por `add_page/2` e `create_audit/3`. Devolve a página, a auditoria
  # com os contadores atualizados e os eventos a publicar depois do commit.
  defp append_page(audit, url, now) do
    with :ok <- check_new_page(audit, url),
         {:ok, page} <- Repo.insert(Page.create_changeset(audit, url)),
         {:ok, _task} <- Repo.insert(PageTask.create_changeset(page, %{kind: :scan})),
         {:ok, _job} <- Oban.insert(ScanPageJob.new(%{"page_id" => page.id})),
         {:ok, audit, events} <- settle(audit, now) do
      {:ok, page, audit, events}
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
      do: transact_and_publish(fn -> insert_task(page_id, kind) end),
      else: {:error, :invalid_kind}
  end

  defp insert_task(page_id, kind) do
    with {:ok, audit, page, tasks} <- lock_chain(page_id),
         :ok <- check_page_open(page),
         :ok <- check_new_kind(tasks, kind),
         {:ok, task} <- Repo.insert(PageTask.create_changeset(page, %{kind: kind})),
         {:ok, refreshed} <- refresh_page(page, tasks ++ [task]),
         {:ok, _audit, events} <- settle(audit, now(), {page, refreshed}) do
      {:ok, {task, events}}
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
    transact_and_publish(fn ->
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
           {:ok, started} <- refresh_page(page, replace(tasks, task)),
           {:ok, _audit, events} <-
             commit_progress(
               audit,
               %{status: :running, started_at: audit.started_at || now},
               {page, started}
             ) do
        {:ok, {%{task | page: started}, events}}
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
  `{:error, :invalid_scan_result}`. Achado que não passa no changeset (recusa causada pelos
  dados do scanner) devolve `{:error, {:invalid_finding, changeset}}`, e a lista de regras
  aprovadas que o banco recusa (acima de 64 KB) devolve
  `{:error, {:invalid_passed_rules, changeset}}`; nos dois casos nada é gravado. Os
  outros erros (trava, tarefa ou página ausente, changeset da tarefa, da página ou da
  auditoria) voltam como estão: são do ciclo de vida ou do banco, não do resultado.

  Os achados `source: :axe` da página são apagados e regravados na mesma transação: varrer a
  página de novo não duplica nada. Achados de outras fontes ficam. `pages.passed_rules`
  (RF-RA017, `Rampa.Audits.AxeMapper.passed_rules/1`) é sempre regravada, com `nil` quando o
  resultado vem sem `axe.passes`.
  """
  @spec record_scan_result(Page.t(), map()) ::
          {:ok, Page.t()}
          | {:error,
             transition_error()
             | :invalid_scan_result
             | {:invalid_finding, Ecto.Changeset.t()}
             | {:invalid_passed_rules, Ecto.Changeset.t()}
             | Ecto.Changeset.t()}
  def record_scan_result(%Page{id: page_id}, result) do
    case PageData.sanitize(result) do
      %{"axe" => %{} = axe} = result ->
        transact_and_publish(fn -> save_scan(page_id, result, axe) end)

      _invalid ->
        {:error, :invalid_scan_result}
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
    transact_and_publish(fn ->
      with {:ok, audit, page, tasks} <- lock_chain(page_id),
           {:ok, task} <- fetch_open_task(tasks, kind),
           {:ok, page, events} <- fail_locked(audit, page, tasks, task, to_string(code), now()) do
        {:ok, {page, events}}
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
    transact_and_publish(fn ->
      with {:ok, audit, page, tasks} <- lock_chain(page_id),
           %PageTask{} = task <- Enum.find(tasks, &(&1.id == task_id)),
           true <- stale?(task, tasks, criteria) do
        resolve_stale(audit, page, tasks, task, criteria)
      else
        _not_stale -> {:ok, {:unchanged, []}}
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
  # nada muda. A página só volta a `queued` com um job novo de fato. Reenfileirar não muda o
  # andamento da auditoria (contadores, status, achados): não passa por `commit_progress` e
  # não publica evento.
  defp requeue(page, tasks, task, job) do
    case Oban.insert(job) do
      {:ok, %Oban.Job{conflict?: true}} ->
        {:ok, {:unchanged, []}}

      {:ok, _job} ->
        with {:ok, task} <-
               update_task(task, %{status: :pending, requeues: task.requeues + 1}),
             {:ok, _page} <- refresh_page(page, replace(tasks, task)) do
          Logger.warning(
            "reconciliação: tarefa #{task.kind} da página #{page.id} reenfileirada " <>
              "(#{task.requeues}ª vez)"
          )

          {:ok, {:requeued, []}}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp fail_stale(audit, page, tasks, task, now) do
    with {:ok, _page, events} <- fail_locked(audit, page, tasks, task, "stale", now) do
      Logger.warning("reconciliação: tarefa #{task.kind} da página #{page.id} presa, fechada")
      {:ok, {:failed, events}}
    end
  end

  ## Gravação do scan

  defp save_scan(page_id, result, axe) do
    now = now()

    with {:ok, audit, page, tasks} <- lock_chain(page_id),
         {:ok, task} <- fetch_open_task(tasks, :scan),
         {:ok, task} <- update_task(task, %{status: :done, error: nil, finished_at: now}),
         {:ok, scanned} <-
           refresh_scanned(page, replace(tasks, task), scan_attrs(result, axe, now)),
         {_deleted, _} <- Repo.delete_all(axe_findings_query(scanned.id)),
         {:ok, _count} <- insert_findings(scanned, axe, DateTime.utc_now()),
         {:ok, _audit, events} <- settle(audit, now, {page, scanned}) do
      {:ok, {scanned, events}}
    end
  end

  # `passed_rules` vai sempre, mesmo `nil` (scanner sem `axe.passes`): uma nova varredura
  # não deixa a lista de uma varredura anterior.
  defp scan_attrs(result, axe, now) do
    %{
      final_url: result["final_url"],
      http_status: result["http_status"],
      title: PageData.truncate_bytes(result["title"], @title_max_bytes),
      axe_version: axe["version"],
      scanned_at: now,
      passed_rules: AxeMapper.passed_rules(axe)
    }
  end

  # A lista de regras aprovadas vem do scanner: recusada pelo banco (acima de 64 KB), é
  # recusa causada pelos dados do scanner, como um achado inválido.
  defp refresh_scanned(page, tasks, attrs) do
    case refresh_page(page, tasks, attrs) do
      {:error, %Ecto.Changeset{errors: errors} = changeset} ->
        if Keyword.has_key?(errors, :passed_rules),
          do: {:error, {:invalid_passed_rules, changeset}},
          else: {:error, changeset}

      result ->
        result
    end
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
        {:error, changeset} -> {:halt, {:error, {:invalid_finding, changeset}}}
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
    # `severity_rank` é coluna gerada no banco: não entra no `INSERT`.
    |> Map.take(Finding.__schema__(:fields) -- [:severity_rank])
    |> Map.merge(%{id: Ecto.UUID.generate(), inserted_at: now, updated_at: now})
  end

  ## Falha, página e regra de conclusão (sempre com a auditoria, a página e as tarefas travadas)

  defp fail_locked(audit, page, tasks, task, error, now) do
    with {:ok, tasks} <- close_failed(tasks, task, error, now),
         {:ok, closed} <- refresh_page(page, tasks),
         {:ok, _audit, events} <- settle(audit, now, {page, closed}) do
      {:ok, closed, events}
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
  # nenhuma. O erro da auditoria `failed` é o da página que acabou de falhar (`closing`, a
  # página depois da transição), a última; sem ela, o da página falha mais recente. Não
  # consulta o Oban. `pages` é a página de antes e de depois da transição (ou `{nil, nil}`),
  # para os eventos. Devolve a auditoria gravada e os eventos.
  defp settle(%Audit{} = audit, now, {_before, closing} = pages \\ {nil, nil}) do
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

    commit_progress(audit, Map.merge(counters, final), pages)
  end

  # Ponto único de escrita do andamento da auditoria (sempre com ela travada, e só por aqui).
  # Sobe a `revision` sempre, mesmo que nada mais mude (um changeset sem mudança não emitiria
  # SQL e a `revision` ficaria parada), grava e deriva os eventos do diff entre o estado de
  # antes e o que o `UPDATE` devolveu. Só se houver evento lê o snapshot, na mesma transação
  # (o agregado dos achados não roda à toa com a auditoria travada). Os eventos da transação
  # compartilham a `revision` e o `progress`; quem publica é `transact_and_publish/1`, depois
  # do commit.
  defp commit_progress(%Audit{} = audit, attrs, {page_before, page_after}) do
    changeset =
      audit
      |> Audit.progress_changeset(attrs)
      |> Ecto.Changeset.force_change(:revision, audit.revision + 1)

    with {:ok, updated} <- Repo.update(changeset) do
      case Events.diff(audit, updated, page_before, page_after) do
        [] -> {:ok, updated, []}
        changes -> build_events(updated, changes)
      end
    end
  end

  defp build_events(%Audit{} = updated, changes) do
    with {:ok, snapshot, totals, needs_review} <- read_snapshot(updated.id) do
      progress = progress(snapshot, totals, needs_review)

      events =
        Enum.map(changes, fn {name, data} ->
          %Events.Event{
            name: name,
            audit_id: snapshot.id,
            revision: snapshot.revision,
            progress: progress,
            data: event_data(name, data)
          }
        end)

      {:ok, snapshot, events}
    end
  end

  # `page_scanned` leva as contagens da página, com a mesma consulta dos totais da auditoria.
  defp event_data(:page_scanned, %{page_id: page_id} = data) do
    {counts, needs_review} = :page_id |> finding_counts(page_id) |> Repo.one() |> split_counts()
    Map.merge(data, %{counts_by_severity: counts, needs_review_count: needs_review})
  end

  defp event_data(_name, data), do: data

  # Roda `fun` numa transação que devolve `{:ok, {resultado, eventos}}` e publica os eventos
  # **depois do commit**. Transação desfeita (`{:error, _}` ou exceção) não publica nada.
  defp transact_and_publish(fun) do
    case Repo.transact(fun) do
      {:ok, {result, events}} ->
        :ok = Events.publish(events)
        {:ok, result}

      {:error, _reason} = error ->
        error
    end
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
