defmodule Rampa.Audits.AxeMapperPropertyTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  import Rampa.PageGenerators, only: [text: 0]

  alias Rampa.Audits.{AxeMapper, Finding, PageData}
  alias StreamData, as: SD

  # RF-RA003 e RNF-RA005: a conversão do resultado do axe aguenta qualquer conteúdo no
  # formato do contrato do scanner (PRD §7). Os exemplos fixos ficam em `axe_mapper_test.exs`.

  @impacts ["critical", "serious", "moderate", "minor", nil]
  @severities %{
    "critical" => :critical,
    "serious" => :serious,
    "moderate" => :moderate,
    "minor" => :minor
  }
  @tags ~w(wcag2a wcag2aa wcag21aa wcag22aa wcag111 wcag143 wcag1410 wcag2411 wcag412
           best-practice EN-301-549 EN-9.1.1.1 cat.text-alternatives section508)
  @raw_keys ["id", "tags", "help", "helpUrl", "impact", "nodes_total"]

  defp impact, do: SD.member_of(@impacts)

  defp target do
    level = SD.one_of([text(), SD.list_of(text(), min_length: 1, max_length: 3)])
    SD.list_of(level, min_length: 1, max_length: 4)
  end

  defp axe_node do
    gen all target <- target(),
            html <- text(),
            summary <- SD.one_of([text(), SD.constant(nil)]),
            impact <- impact(),
            truncated? <- SD.boolean() do
      node = %{
        "target" => target,
        "html" => html,
        "failureSummary" => summary,
        "impact" => impact
      }

      if truncated?, do: Map.put(node, "target_truncated", true), else: node
    end
  end

  defp rule do
    gen all id <- SD.string(:utf8, min_length: 1, max_length: 40),
            impact <- impact(),
            tags <- SD.list_of(SD.one_of([SD.member_of(@tags), text()]), max_length: 6),
            description <- text(),
            help <- text(),
            help_url <- text(),
            nodes <- SD.list_of(axe_node(), max_length: 4),
            extra <- SD.integer(0..100) do
      %{
        "id" => id,
        "impact" => impact,
        "tags" => tags,
        "description" => description,
        "help" => help,
        "helpUrl" => help_url,
        "nodes" => nodes,
        "nodes_total" => length(nodes) + extra
      }
    end
  end

  defp axe do
    gen all violations <- SD.list_of(rule(), max_length: 3),
            incomplete <- SD.list_of(rule(), max_length: 3) do
      %{"version" => "4.14.0", "violations" => violations, "incomplete" => incomplete}
    end
  end

  # Pares {regra, nó, needs_review} na ordem em que os achados devem sair.
  defp expected_pairs(axe) do
    for {key, review?} <- [{"violations", false}, {"incomplete", true}],
        rule <- axe[key],
        node <- rule["nodes"],
        do: {rule, node, review?}
  end

  property "um achado por nó, na ordem, com os campos dentro dos limites" do
    check all axe <- axe(), max_runs: 150 do
      findings = AxeMapper.to_findings(axe)
      pairs = expected_pairs(axe)

      assert length(findings) == length(pairs)

      for {finding, {rule, node, review?}} <- Enum.zip(findings, pairs) do
        assert finding.source == :axe
        assert finding.rule_id == rule["id"]
        assert finding.needs_review == review?
        assert finding.confidence == nil

        assert finding.severity ==
                 (@severities[node["impact"]] || @severities[rule["impact"]] || :moderate)

        snippet = finding.html_snippet
        assert byte_size(snippet) <= Finding.html_snippet_max_bytes()
        assert String.valid?(snippet)
        assert String.starts_with?(node["html"], snippet)

        assert finding.message == (node["failureSummary"] || rule["help"])

        for criterion <- finding.wcag_criteria, do: assert(criterion =~ ~r/\A\d\.\d\.\d+\z/)
        assert finding.wcag_criteria == Enum.uniq(finding.wcag_criteria)

        assert finding.raw |> Map.keys() |> Enum.all?(&(&1 in @raw_keys))

        if node["target_truncated"],
          do: assert(finding.selector == nil),
          else: assert(is_binary(finding.selector))
      end
    end
  end

  property "depois do saneamento, nenhum achado tem NUL" do
    check all axe <- axe(), max_runs: 100 do
      for finding <- axe |> PageData.sanitize() |> AxeMapper.to_findings(),
          value <- [finding.rule_id, finding.selector, finding.html_snippet, finding.message],
          is_binary(value) do
        refute String.contains?(value, <<0>>)
      end
    end
  end

  property "lista ou regra fora do formato é ignorada, sem exceção" do
    junk = SD.one_of([SD.constant(nil), SD.integer(), text(), SD.list_of(SD.integer())])

    list = SD.one_of([junk, SD.list_of(SD.one_of([junk, rule()]), max_length: 3)])

    check all violations <- list, incomplete <- list, max_runs: 60 do
      findings = AxeMapper.to_findings(%{"violations" => violations, "incomplete" => incomplete})
      rules = Enum.filter(List.wrap(violations) ++ List.wrap(incomplete), &is_map/1)

      assert length(findings) == Enum.sum_by(rules, &length(&1["nodes"]))
    end
  end
end
