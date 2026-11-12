defmodule RampaWeb.FindingJSON do
  @moduledoc """
  Achados de uma auditoria: `{ "data": [...], "next_cursor": string | null, "total" }`, e o
  detalhe de um (RF-RA007). `raw` e `crop_path` nunca saem: do `raw` saem só `help`, o
  `help_url` (só se for da documentação do axe, ver `help_url/1`) e o `nodes_total`.
  """

  alias Rampa.Audits.{Finding, Page}

  # Endereço da documentação das regras do axe. Qualquer outro `helpUrl` sai `null`: o campo
  # vira link na interface, e um `javascript:` ou um endereço qualquer não pode chegar lá.
  @help_url ~r{\Ahttps://dequeuniversity\.com/[!-~]*\z}

  def index(%{page: %{data: findings, next_cursor: next_cursor, total: total}}) do
    %{data: Enum.map(findings, &data/1), next_cursor: next_cursor, total: total}
  end

  def show(%{detail: %{finding: %Finding{} = finding, page: %Page{} = page} = detail}) do
    finding
    |> data()
    |> Map.merge(%{
      audit_id: finding.audit_id,
      help_url: help_url(raw(finding, "helpUrl")),
      nodes_total: nodes_total(raw(finding, "nodes_total")),
      who_is_affected: finding.who_is_affected,
      how_to_fix: finding.how_to_fix,
      ai_reason: finding.ai_reason,
      ai_suggestion: finding.ai_suggestion,
      ai_model: finding.ai_model,
      prompt_version: finding.prompt_version,
      axe_version: if(finding.source == :axe, do: page.axe_version),
      inserted_at: finding.inserted_at,
      page: %{id: page.id, url: page.url, final_url: page.final_url, title: page.title},
      occurrences: detail.occurrences,
      other_pages: detail.other_pages
    })
  end

  defp data(%Finding{} = finding) do
    %{
      id: finding.id,
      page_id: finding.page_id,
      source: finding.source,
      rule_id: finding.rule_id,
      help: text(raw(finding, "help")),
      wcag_criteria: finding.wcag_criteria,
      severity: finding.severity,
      needs_review: finding.needs_review,
      confidence: finding.confidence,
      selector: finding.selector,
      html_snippet: finding.html_snippet,
      message: finding.message
    }
  end

  defp raw(%Finding{raw: %{} = raw}, key), do: raw[key]
  defp raw(%Finding{}, _key), do: nil

  defp text(value) when is_binary(value), do: value
  defp text(_other), do: nil

  @doc false
  def help_url(url) when is_binary(url),
    do: if(Regex.match?(@help_url, url), do: url, else: nil)

  def help_url(_other), do: nil

  defp nodes_total(value) when is_integer(value) and value >= 0, do: value
  defp nodes_total(_other), do: nil
end
