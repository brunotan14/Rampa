defmodule Rampa.Audits.AxeMapperTest do
  use ExUnit.Case, async: true

  import Rampa.AuditsFixtures, only: [scanner_response: 1]

  alias Rampa.Audits.AxeMapper

  defp rule(attrs) do
    Map.merge(
      %{
        "id" => "image-alt",
        "impact" => "critical",
        "tags" => ["wcag2a", "wcag111"],
        "description" => "Ensure <img> elements have alternative text",
        "help" => "Images must have alternative text",
        "helpUrl" => "https://dequeuniversity.com/rules/axe/4.14/image-alt",
        "nodes" => [node_result(%{})]
      },
      attrs
    )
  end

  defp node_result(attrs) do
    Map.merge(
      %{
        "target" => ["img"],
        "html" => ~s(<img src="a.png">),
        "failureSummary" => "Fix any of the following: ...",
        "impact" => "critical"
      },
      attrs
    )
  end

  defp axe(violations, incomplete \\ []),
    do: %{"version" => "4.14.0", "violations" => violations, "incomplete" => incomplete}

  describe "to_findings/1 com respostas reais do scanner" do
    test "img-sem-alt vira um achado image-alt crítico, critério 1.1.1, sem revisão" do
      assert [finding] = AxeMapper.to_findings(scanner_response("img-sem-alt")["axe"])

      assert %{
               source: :axe,
               rule_id: "image-alt",
               severity: :critical,
               needs_review: false,
               confidence: nil,
               selector: "img"
             } = finding

      assert "1.1.1" in finding.wcag_criteria
      assert finding.html_snippet =~ ~r/^<img /
      assert finding.message =~ "Element does not have an alt attribute"
    end

    test "limpa não gera achado" do
      assert AxeMapper.to_findings(scanner_response("limpa")["axe"]) == []
    end

    test "incomplete vira achado com needs_review" do
      findings = AxeMapper.to_findings(scanner_response("contraste-incerto")["axe"])

      assert [%{rule_id: "color-contrast", needs_review: true, source: :axe} = finding] = findings
      assert finding.wcag_criteria == ["1.4.3"]
      assert finding.severity == :serious
    end
  end

  describe "to_findings/1" do
    test "gera um achado por nó" do
      nodes = [node_result(%{"target" => ["#a"]}), node_result(%{"target" => ["#b"]})]

      assert [%{selector: "#a"}, %{selector: "#b"}] =
               AxeMapper.to_findings(axe([rule(%{"nodes" => nodes})]))
    end

    test "violations vêm antes de incomplete e cada grupo mantém o needs_review certo" do
      findings =
        AxeMapper.to_findings(axe([rule(%{})], [rule(%{"id" => "color-contrast"})]))

      assert [
               %{rule_id: "image-alt", needs_review: false},
               %{rule_id: "color-contrast", needs_review: true}
             ] =
               findings
    end

    test "aceita grupos ausentes" do
      assert AxeMapper.to_findings(%{"version" => "4.14.0"}) == []
    end

    test "message cai para o help da regra quando o nó não tem failureSummary" do
      [finding] =
        AxeMapper.to_findings(
          axe([rule(%{"nodes" => [node_result(%{"failureSummary" => nil})]})])
        )

      assert finding.message == "Images must have alternative text"
    end

    test "raw guarda só id, tags, help, helpUrl e impact da regra" do
      [finding] = AxeMapper.to_findings(axe([rule(%{})]))

      assert finding.raw == %{
               "id" => "image-alt",
               "tags" => ["wcag2a", "wcag111"],
               "help" => "Images must have alternative text",
               "helpUrl" => "https://dequeuniversity.com/rules/axe/4.14/image-alt",
               "impact" => "critical"
             }
    end

    test "html_snippet fica com no máximo 2 KB" do
      html = "<p>" <> String.duplicate("a", 5_000) <> "</p>"

      [finding] =
        AxeMapper.to_findings(axe([rule(%{"nodes" => [node_result(%{"html" => html})]})]))

      assert byte_size(finding.html_snippet) == 2048
      assert String.starts_with?(html, finding.html_snippet)
    end
  end

  describe "severity/2" do
    test "usa o impact do nó, senão o da regra, senão moderate" do
      assert AxeMapper.severity("minor", "critical") == :minor
      assert AxeMapper.severity(nil, "serious") == :serious
      assert AxeMapper.severity(nil, nil) == :moderate
      assert AxeMapper.severity("desconhecido", nil) == :moderate
    end
  end

  describe "wcag_criteria/1" do
    test "converte as tags de critério e ignora as demais" do
      tags = [
        "cat.text-alternatives",
        "wcag2a",
        "wcag21aa",
        "wcag22aa",
        "wcag111",
        "wcag1410",
        "wcag2411",
        "best-practice",
        "EN-9.1.1.1",
        "RGAA-1.1.1",
        "wcag111"
      ]

      assert AxeMapper.wcag_criteria(tags) == ["1.1.1", "1.4.10", "2.4.11"]
    end

    test "sem tags, lista vazia" do
      assert AxeMapper.wcag_criteria(nil) == []
    end
  end

  describe "selector/1" do
    test "seletor simples" do
      assert AxeMapper.selector(["main > img"]) == "main > img"
    end

    test "níveis de iframe unidos por >>>" do
      assert AxeMapper.selector(["iframe#mapa", "button.zoom"]) == "iframe#mapa >>> button.zoom"
    end

    test "shadow DOM unido por >>" do
      assert AxeMapper.selector([["my-app", "#menu", "a"]]) == "my-app >> #menu >> a"

      assert AxeMapper.selector(["iframe", ["x-card", "img"]]) == "iframe >>> x-card >> img"
    end

    test "target ausente vira nil" do
      assert AxeMapper.selector(nil) == nil
      assert AxeMapper.selector([]) == nil
    end
  end
end
