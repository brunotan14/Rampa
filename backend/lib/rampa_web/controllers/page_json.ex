defmodule RampaWeb.PageJSON do
  @moduledoc """
  Páginas de uma auditoria (RF-RA006) e o detalhe de uma, com as regras aprovadas
  (RF-RA017). O `error` da página vira `{ code, message }` (`RampaWeb.ErrorMessages`).
  `passed_count` e `passed_rules` são `null` quando o scanner não coletou as regras
  aprovadas (página que falhou ou varrida antes do RF-RA017), diferente de `0` e `[]`.
  """

  alias Rampa.Audits.Page
  alias RampaWeb.ErrorMessages

  def index(%{pages: pages}), do: %{data: Enum.map(pages, &summary/1)}

  def show(%{page: %{page: %Page{} = page} = data}) do
    data
    |> summary()
    |> Map.merge(%{axe_version: page.axe_version, passed_rules: passed_rules(page.passed_rules)})
  end

  defp summary(%{page: %Page{} = page} = data) do
    %{
      id: page.id,
      url: page.url,
      final_url: page.final_url,
      title: page.title,
      status: page.status,
      http_status: page.http_status,
      error: error(page.error),
      scanned_at: page.scanned_at,
      counts_by_severity: data.counts_by_severity,
      needs_review_count: data.needs_review_count,
      passed_count: data.passed_count
    }
  end

  defp passed_rules(nil), do: nil

  defp passed_rules(rules) do
    Enum.map(rules, fn rule ->
      %{
        rule_id: rule["rule_id"],
        wcag_criteria: rule["wcag_criteria"] || [],
        help: rule["help"],
        nodes_total: rule["nodes_total"]
      }
    end)
  end

  defp error(nil), do: nil
  defp error(code), do: ErrorMessages.error(code)
end
