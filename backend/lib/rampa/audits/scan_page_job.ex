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

  Tentativas (`max_attempts: 2`):

    * definitivos: as recusas do `URLGuard` (menos `dns_error`), `blocked_address`,
      `invalid_url`, `resource_limit`, `http_error` e `invalid_request` marcam a página
      `failed` na hora e cancelam o job (`{:cancel, code}`);
    * qualquer outra falha pode ser passageira e ganha uma nova tentativa: `dns_error`, os
      erros `timeout`, `navigation_failed`, `analysis_failed` e `unavailable` do scanner, a
      gravação recusada (`invalid_scan_result`) e exceções (`internal_error`). Na última
      tentativa a página é marcada `failed` com o código e a auditoria é atualizada; o job
      devolve `{:error, code}` (ou relança a exceção) para o Oban registrar;
    * página que já terminou (`done`/`failed`) ou de auditoria encerrada (`completed`,
      `failed`, `cancelled`) não é varrida: `{:cancel, :already_finished}`. Cancelar, em vez
      de devolver `:ok`, deixa visível no Oban que o job não fez nada.

  Um job por página por vez: `unique` em `page_id` nos estados não finais do Oban.
  """

  use Oban.Worker,
    queue: :scan,
    max_attempts: 2,
    unique: [keys: [:page_id], period: :infinity, states: :incomplete]

  require Logger

  alias Rampa.Audits
  alias Rampa.Audits.Page
  alias Rampa.Scanner.Client
  alias Rampa.Security.URLGuard

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
  def perform(%Oban.Job{args: %{"page_id" => page_id}} = job) do
    Logger.metadata(page_id: page_id)

    case Audits.start_page_scan(page_id) do
      {:ok, page} -> run(page, job)
      {:error, reason} when reason in [:page_not_found, :already_finished] -> {:cancel, reason}
      {:error, reason} -> {:error, reason}
    end
  end

  defp run(%Page{} = page, job) do
    Logger.metadata(audit_id: page.audit_id)

    with {:ok, url} <- guard(page),
         {:ok, result} <- scan(url),
         {:ok, _page} <- record(page, result) do
      :ok
    else
      {:error, :already_finished} -> {:cancel, :already_finished}
      {:error, code, detail} -> fail(page, job, code, detail)
    end
  rescue
    exception ->
      fail(page, job, :internal_error, Exception.message(exception))
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

  # Caminho único de falha: definitiva ou na última tentativa, a página é marcada `failed`.
  defp fail(page, job, code, detail) do
    definitive? = code in @definitive
    last_attempt? = job.attempt >= job.max_attempts

    Logger.warning(
      "scan: tentativa #{job.attempt}/#{job.max_attempts} falhou: #{code}: #{detail}"
    )

    if definitive? or last_attempt?, do: mark_failed(page, code)

    if definitive?, do: {:cancel, code}, else: {:error, code}
  end

  # Não pode esconder a falha original: um erro aqui só é registrado no log.
  defp mark_failed(page, code) do
    case Audits.record_scan_failure(page, code) do
      {:ok, _page} -> :ok
      {:error, :already_finished} -> :ok
      {:error, reason} -> log_mark_failed(reason)
    end
  rescue
    exception -> log_mark_failed(exception)
  end

  defp log_mark_failed(reason),
    do: Logger.error("scan: não consegui marcar a página como falha: #{inspect(reason)}")
end
