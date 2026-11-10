defmodule Rampa.Audits.ScanPageJob do
  @moduledoc """
  Varre uma página com o scanner e grava os fatos e os achados do axe (PRD §7, passo 2;
  RF-RA003). Args: `%{"page_id" => id}`.

  Tentativas: `timeout`, `navigation_failed` e `unavailable` podem ser passageiros e têm uma
  segunda tentativa; a página só é marcada `failed` na última. `blocked_address` e
  `http_error` são definitivos: a página é marcada `failed` na hora e o job é cancelado.

  Idempotente: rodar de novo regrava os achados do axe da página, sem duplicar.
  """

  use Oban.Worker, queue: :scan, max_attempts: 2

  require Logger

  alias Rampa.Audits
  alias Rampa.Audits.Page
  alias Rampa.Scanner.Client

  @retryable [:timeout, :navigation_failed, :unavailable]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"page_id" => page_id}} = job) do
    Logger.metadata(page_id: page_id)

    case Audits.get_page(page_id) do
      nil -> {:cancel, :page_not_found}
      %Page{} = page -> scan(page, job)
    end
  end

  defp scan(page, job) do
    Logger.metadata(audit_id: page.audit_id)

    with {:ok, page} <- Audits.start_page_scan(page) do
      case Client.impl().scan(page.url) do
        {:ok, result} -> record_result(page, result)
        {:error, %{code: code} = error} -> handle_error(page, code, error, job)
      end
    end
  end

  defp record_result(page, result) do
    case Audits.record_scan_result(page, result) do
      {:ok, _page} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp handle_error(page, code, error, job) when code in @retryable do
    Logger.warning("scan: falha na tentativa #{job.attempt}: #{code}: #{error.detail}")

    if job.attempt < job.max_attempts do
      {:error, code}
    else
      with {:ok, _page} <- Audits.record_scan_failure(page, code), do: {:error, code}
    end
  end

  defp handle_error(page, code, error, _job) do
    Logger.warning("scan: falha definitiva: #{code}: #{error.detail}")

    with {:ok, _page} <- Audits.record_scan_failure(page, code), do: {:cancel, code}
  end
end
