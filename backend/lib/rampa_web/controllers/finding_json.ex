defmodule RampaWeb.FindingJSON do
  @moduledoc """
  Achados de uma auditoria: `{ "data": [...], "next_cursor": string | null }`. Só os campos
  do M1; `raw`, `crop_path` e os campos de IA (preenchidos a partir do M4) não saem.
  """

  alias Rampa.Audits.Finding

  def index(%{page: %{data: findings, next_cursor: next_cursor}}) do
    %{data: Enum.map(findings, &data/1), next_cursor: next_cursor}
  end

  defp data(%Finding{} = finding) do
    %{
      id: finding.id,
      page_id: finding.page_id,
      source: finding.source,
      rule_id: finding.rule_id,
      wcag_criteria: finding.wcag_criteria,
      severity: finding.severity,
      needs_review: finding.needs_review,
      confidence: finding.confidence,
      selector: finding.selector,
      html_snippet: finding.html_snippet,
      message: finding.message
    }
  end
end
