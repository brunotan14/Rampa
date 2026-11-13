defmodule Rampa.Audits.ScanPageJob do
  @moduledoc """
  Varre uma página com o scanner e grava os fatos e os achados do axe (PRD §7, passo 2;
  RF-RA003). Args: `%{"page_id" => id}`.

  Antes de chamar o scanner, a URL da página passa de novo pelo `Rampa.Security.URLGuard`
  (RF-RA002): defesa em profundidade para as páginas que não vieram de `POST /api/audits`,
  como os links descobertos no M5. URL recusada marca a página `failed` com o código da
  recusa (`blocked_address`, `unsupported_scheme`, `invalid_url` ou `unresolvable`), sem
  chamar o scanner. Falha do resolvedor de DNS (`dns_error`) é passageira e ganha nova
  tentativa.

  Opera sobre a tarefa `scan` da página (`Rampa.Audits.PageTask`;
  ciclo de vida em `Rampa.Audits.Rules`): marca a tarefa `running` com o `attempt`,
  grava o resultado e fecha a tarefa `done`, ou `failed` na falha definitiva ou na última
  tentativa. Fechar a tarefa roda a regra de conclusão da auditoria na mesma transação.

  Tentativas (`max_attempts: 2`):

    * definitivos: as recusas do `URLGuard` (menos `dns_error`), `blocked_address`,
      `invalid_url`, `resource_limit`, `invalid_request`, `invalid_scan_result` e o
      `http_error` com outro status que não 429, 502, 503 ou 504 (inclusive sem status:
      400, 401, 403, 404, 410, 500...) fecham a tarefa `failed` na hora. `invalid_scan_result` é uma
      resposta 200 com a versão certa do contrato, mas fora do schema, ou um achado que o
      changeset recusa na gravação, ou a lista de regras aprovadas acima do limite do banco (os
      dados do scanner): o mesmo scanner devolveria o
      mesmo resultado;
    * qualquer outra falha pode ser passageira e ganha uma nova tentativa: `dns_error`, o
      `http_error` com 429, 502, 503 ou 504 (RF-RA029: site instável ou limitando robôs; o
      `Retry-After` não é lido), os erros `timeout`, `navigation_failed`, `analysis_failed`
      e `unavailable` do scanner,
      `contract_mismatch` (versão do contrato diferente, como durante um deploy em que o
      scanner e o app trocam em momentos diferentes; uma nova tentativa só, e a divergência
      fica no log como erro), o prazo da varredura estourado (`timeout`), os erros da
      gravação que não vêm dos dados do scanner (trava, changeset da tarefa, da página ou da
      auditoria, erro do banco) e exceções ou `exit` (`internal_error`). A tarefa fica
      `running` entre as tentativas. Na
      última (do job, ou da tarefa, que continua contando depois de um reenfileiramento pela
      reconciliação) a tarefa fecha `failed` com o código;
    * sempre que a tarefa é fechada `failed`, o job devolve `{:cancel, code}`: não há o que
      tentar de novo. Enquanto ainda há tentativa, devolve `{:error, code}` (ou relança a
      exceção ou o `exit`) para o Oban tentar de novo;
    * tarefa já terminada, página sem tarefa `scan` ou auditoria encerrada (`completed`,
      `failed`, `cancelled`) não é varrida: `{:cancel, reason}`. Se a tarefa ou a página
      some, ou a tarefa termina, durante a varredura, a gravação também cancela. Cancelar, em vez de devolver
      `:ok`, deixa visível no Oban que o job não fez nada.

  Prazo: a varredura roda num processo filho (`Rampa.TaskSupervisor`) com o prazo de
  `config :rampa, :scan_deadline_ms` (150 s: DNS de 5 s, cliente do scanner de 100 s e a
  gravação). Estourado, o filho é encerrado e a falha é tratada como `timeout`. O `timeout` do
  Oban (3 min) fica de reserva: ele encerra o processo do job de fora, sem chance de gravar a
  falha, e aí quem fecha a tarefa é a reconciliação, assim que o job deixa de estar vivo e o
  prazo de `running` (timeout + folga) passa. O `timeout` fica abaixo do `rescue_after` do
  `Oban.Lifeline`: um job vivo nunca é resgatado.

  Espera entre as tentativas (`backoff/1`): `config :rampa, :scan_retry_backoff_seconds`,
  fixa e sem depender do `Retry-After` do site (só no Compose de teste ela é curta).

  Na falha que fecha a tarefa, a página grava o status HTTP do documento (só o do
  `http_error`, senão `nil`) e a decisão de barreira de login sobre ele
  (`Rampa.Audits.fail_task/4`, RF-RA028 e RF-RA029).

  Um job por página por vez: `unique` em `page_id` nos estados não finais do Oban.
  """

  use Oban.Worker,
    queue: :scan,
    max_attempts: 2,
    unique: [keys: [:page_id], period: :infinity, states: :incomplete]

  require Logger

  alias Rampa.Audits
  alias Rampa.Audits.PageTask
  alias Rampa.Scanner.Client
  alias Rampa.Security.URLGuard

  @timeout_ms :timer.minutes(3)

  @definitive [
    :blocked_address,
    :unsupported_scheme,
    :invalid_url,
    :unresolvable,
    :resource_limit,
    :invalid_request,
    :invalid_scan_result
  ]

  # Na gravação: nada a gravar (tarefa ou página sumiu, ou a tarefa já terminou). O job é
  # cancelado sem marcar falha, como quando `start_task/3` devolve o mesmo.
  @nothing_to_record [:already_finished, :task_not_found, :page_not_found]

  # `http_error` passageiro (RF-RA029): o site pode voltar numa nova tentativa.
  @transient_http_statuses [429, 502, 503, 504]

  @impl Oban.Worker
  def timeout(_job), do: @timeout_ms

  @impl Oban.Worker
  def backoff(_job), do: Application.fetch_env!(:rampa, :scan_retry_backoff_seconds)

  @doc """
  A falha é definitiva (não melhora com nova tentativa)? `http_error` depende do status do
  documento: 429, 502, 503 e 504 são passageiros; o resto, inclusive sem status, definitivo.
  """
  @spec definitive?(atom(), integer() | nil) :: boolean()
  def definitive?(:http_error, status), do: status not in @transient_http_statuses
  def definitive?(code, _status), do: code in @definitive

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"page_id" => page_id}} = job) do
    Logger.metadata(page_id: page_id)

    case Audits.start_task(page_id, :scan, job.attempt) do
      {:ok, task} ->
        supervise(task, job)

      {:error, reason} when reason in [:page_not_found, :task_not_found, :already_finished] ->
        {:cancel, reason}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # A varredura roda num processo filho com prazo; este processo só decide o desfecho.
  defp supervise(%PageTask{page: page} = task, job) do
    Logger.metadata(audit_id: page.audit_id)
    metadata = Logger.metadata()

    child =
      Task.Supervisor.async_nolink(Rampa.TaskSupervisor, fn ->
        Logger.metadata(metadata)
        scan_page(page)
      end)

    case Task.yield(child, deadline_ms()) || Task.shutdown(child, :brutal_kill) do
      {:ok, :ok} -> :ok
      {:ok, {:error, reason}} when reason in @nothing_to_record -> {:cancel, reason}
      {:ok, {:error, code, detail, opts}} -> fail(task, job, code, detail, opts)
      {:exit, reason} -> crashed(task, job, reason)
      nil -> fail(task, job, :timeout, "a varredura passou de #{deadline_ms()} ms", [])
    end
  end

  # Toda falha da varredura sai como `{:error, code, detail, opts}` (`opts`: `:http_status`
  # no `http_error`), num formato só; `{:error, reason}` é só o "nada a gravar".
  defp scan_page(page) do
    with {:ok, url} <- guard(page),
         {:ok, result} <- scan(url),
         {:ok, _page} <- record(page, result) do
      :ok
    end
  end

  defp deadline_ms, do: Application.fetch_env!(:rampa, :scan_deadline_ms)

  # Exceção ou `exit` no filho. Na última tentativa, a tarefa fecha `internal_error` e o job é
  # cancelado; antes disso, a falha original volta ao Oban para uma nova tentativa.
  defp crashed(task, job, reason) do
    {kind, error, stacktrace} =
      case reason do
        {exception, stack} when is_exception(exception) and is_list(stack) ->
          {:error, exception, stack}

        other ->
          {:exit, other, []}
      end

    case fail(task, job, :internal_error, Exception.format_banner(kind, error, stacktrace), []) do
      {:cancel, _code} = cancel -> cancel
      {:error, _code} -> reraise_crash(kind, error, stacktrace)
    end
  end

  # A exceção volta com a stacktrace do filho; o `exit`, como um `exit` deste processo.
  defp reraise_crash(:error, exception, stacktrace), do: reraise(exception, stacktrace)
  defp reraise_crash(:exit, reason, _stacktrace), do: exit(reason)

  defp guard(page) do
    case URLGuard.validate(page.url) do
      {:ok, url} -> {:ok, url}
      {:error, reason} -> {:error, reason, "URL recusada antes da varredura", []}
    end
  end

  defp scan(url) do
    case Client.impl().scan(url) do
      {:ok, result} ->
        {:ok, result}

      {:error, %{code: code, detail: detail} = error} ->
        {:error, code, detail, http_status: error[:http_status]}
    end
  end

  # Só a recusa causada pelos dados do scanner é `invalid_scan_result` (definitivo). Tarefa
  # ou página que sumiu, ou tarefa já fechada, cancelam como no início do job. O resto (trava,
  # changeset da tarefa, da página ou da auditoria, erro do banco) é `internal_error`, que
  # ganha nova tentativa.
  defp record(page, result) do
    case Audits.record_scan_result(page, result) do
      {:ok, page} ->
        {:ok, page}

      {:error, reason} when reason in @nothing_to_record ->
        {:error, reason}

      {:error, :invalid_scan_result} ->
        {:error, :invalid_scan_result, "resultado sem axe", []}

      {:error, {:invalid_finding, changeset}} ->
        {:error, :invalid_scan_result, "achado recusado: #{inspect(changeset.errors)}", []}

      {:error, {:invalid_passed_rules, changeset}} ->
        {:error, :invalid_scan_result, "regras aprovadas recusadas: #{inspect(changeset.errors)}",
         []}

      {:error, reason} ->
        {:error, :internal_error, "gravação do resultado falhou: #{inspect(reason)}", []}
    end
  end

  # Caminho único de falha: definitiva ou na última tentativa, a tarefa fecha `failed` e o job
  # é cancelado. A última tentativa conta também as da tarefa (depois de um reenfileiramento
  # pela reconciliação, o `attempt` do Oban recomeça do 1). `opts`: `:http_status`, o status do
  # documento no `http_error` (já validado pelo `Rampa.Scanner.Contract`).
  defp fail(task, job, code, detail, opts) do
    http_status = Keyword.get(opts, :http_status)
    definitive? = definitive?(code, http_status)
    last_attempt? = max(job.attempt, task.attempt) >= job.max_attempts

    Logger.warning(
      "scan: tentativa #{task.attempt}/#{job.max_attempts} falhou: #{code}: #{detail}"
    )

    closed? = (definitive? or last_attempt?) and mark_failed(task, code, http_status)

    if closed? or definitive?, do: {:cancel, code}, else: {:error, code}
  end

  # Devolve se a tarefa foi fechada. Não pode esconder a falha original: um erro aqui só é
  # registrado no log, e a tarefa que ficar `running` é fechada pela reconciliação.
  defp mark_failed(task, code, http_status) do
    case Audits.fail_task(task.page_id, :scan, code, http_status: http_status) do
      {:ok, _page} ->
        true

      {:error, :already_finished} ->
        false

      {:error, reason} ->
        log_mark_failed(reason)
        false
    end
  rescue
    exception ->
      log_mark_failed(exception)
      false
  end

  defp log_mark_failed(reason),
    do: Logger.error("scan: não consegui fechar a tarefa como falha: #{inspect(reason)}")
end
