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
      `invalid_url`, `resource_limit`, `http_error` e `invalid_request` fecham a tarefa
      `failed` na hora e cancelam o job (`{:cancel, code}`);
    * qualquer outra falha pode ser passageira e ganha uma nova tentativa: `dns_error`, os
      erros `timeout`, `navigation_failed`, `analysis_failed` e `unavailable` do scanner, a
      gravação recusada (`invalid_scan_result`) e exceções (`internal_error`). A tarefa fica
      `running` entre as tentativas. Na última (do job, ou da tarefa, que continua contando
      depois de um reenfileiramento pela reconciliação) a tarefa fecha `failed` com o código;
      o job devolve `{:error, code}` (ou relança a exceção) para o Oban registrar;
    * tarefa já terminada, página sem tarefa `scan` ou auditoria encerrada (`completed`,
      `failed`, `cancelled`) não é varrida: `{:cancel, reason}`. Cancelar, em vez de devolver
      `:ok`, deixa visível no Oban que o job não fez nada.

  Um job por página por vez: `unique` em `page_id` nos estados não finais do Oban. O
  `timeout` de 3 min cobre o DNS (5 s) e o cliente do scanner (100 s)
  e fica abaixo do `rescue_after` do `Oban.Lifeline`: um job vivo nunca é resgatado.
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
    :http_error,
    :invalid_request
  ]

  @impl Oban.Worker
  def timeout(_job), do: @timeout_ms

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"page_id" => page_id}} = job) do
    Logger.metadata(page_id: page_id)

    case Audits.start_task(page_id, :scan, job.attempt) do
      {:ok, task} ->
        run(task, job)

      {:error, reason} when reason in [:page_not_found, :task_not_found, :already_finished] ->
        {:cancel, reason}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp run(%PageTask{page: page} = task, job) do
    Logger.metadata(audit_id: page.audit_id)

    with {:ok, url} <- guard(page),
         {:ok, result} <- scan(url),
         {:ok, _page} <- record(page, result) do
      :ok
    else
      {:error, :already_finished} -> {:cancel, :already_finished}
      {:error, code, detail} -> fail(task, job, code, detail)
    end
  rescue
    exception ->
      fail(task, job, :internal_error, Exception.message(exception))
      reraise exception, __STACKTRACE__
  end

  defp guard(page) do
    case URLGuard.validate(page.url) do
      {:ok, url} -> {:ok, url}
      {:error, reason} -> {:error, reason, "URL recusada antes da varredura"}
    end
  end

  defp scan(url) do
    case Client.impl().scan(url) do
      {:ok, result} -> {:ok, result}
      {:error, %{code: code, detail: detail}} -> {:error, code, detail}
    end
  end

  defp record(page, result) do
    case Audits.record_scan_result(page, result) do
      {:ok, page} -> {:ok, page}
      {:error, :already_finished} -> {:error, :already_finished}
      {:error, :invalid_scan_result} -> {:error, :invalid_scan_result, "resultado sem axe"}
      {:error, reason} -> {:error, :invalid_scan_result, inspect(reason)}
    end
  end

  # Caminho único de falha: definitiva ou na última tentativa, a tarefa fecha `failed`. A
  # última tentativa conta também as da tarefa (depois de um reenfileiramento pela
  # reconciliação, o `attempt` do Oban recomeça do 1).
  defp fail(task, job, code, detail) do
    definitive? = code in @definitive
    last_attempt? = max(job.attempt, task.attempt) >= job.max_attempts

    Logger.warning(
      "scan: tentativa #{task.attempt}/#{job.max_attempts} falhou: #{code}: #{detail}"
    )

    if definitive? or last_attempt?, do: mark_failed(task, code)

    if definitive?, do: {:cancel, code}, else: {:error, code}
  end

  # Não pode esconder a falha original: um erro aqui só é registrado no log. Se a tarefa ficar
  # `running`, a reconciliação a fecha depois do prazo.
  defp mark_failed(task, code) do
    case Audits.fail_task(task.page_id, :scan, code) do
      {:ok, _page} -> :ok
      {:error, :already_finished} -> :ok
      {:error, reason} -> log_mark_failed(reason)
    end
  rescue
    exception -> log_mark_failed(exception)
  end

  defp log_mark_failed(reason),
    do: Logger.error("scan: não consegui fechar a tarefa como falha: #{inspect(reason)}")
end
