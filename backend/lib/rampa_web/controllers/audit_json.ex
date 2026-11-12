defmodule RampaWeb.AuditJSON do
  @moduledoc """
  Resumo da auditoria (`GET /api/audits/:id`, RF-RA005). Nunca expõe `requester_ip_hash` nem
  `idempotency_key`. O `error` interno vira `{ code, message }` com a mensagem pronta
  (`RampaWeb.ErrorMessages`). `revision` é a mesma do canal `audit:<id>` (RF-RA004): o cliente
  fica com o estado de maior `revision`, venha daqui ou do canal. `score` é `null` até o M3.
  """

  alias Rampa.Audits.Audit
  alias RampaWeb.ErrorMessages

  def show(%{summary: %{audit: %Audit{} = audit} = summary}) do
    %{
      id: audit.id,
      revision: audit.revision,
      status: audit.status,
      start_url: audit.start_url,
      page_limit: audit.page_limit,
      pages_found: audit.pages_found,
      pages_scanned: audit.pages_scanned,
      pages_failed: audit.pages_failed,
      score: audit.score,
      totals_by_severity: summary.totals_by_severity,
      needs_review_by_severity: summary.needs_review_by_severity,
      needs_review_count: summary.needs_review_count,
      top_issues: summary.top_issues,
      error: error(audit.error),
      started_at: audit.started_at,
      finished_at: audit.finished_at,
      inserted_at: audit.inserted_at
    }
  end

  defp error(nil), do: nil
  defp error(code), do: ErrorMessages.error(code)
end
