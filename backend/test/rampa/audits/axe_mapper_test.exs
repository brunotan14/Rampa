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

    test "raw guarda o nodes_total da regra (quantos nós havia antes do corte do scanner)" do
      nodes = List.duplicate(node_result(%{}), 20)
      findings = AxeMapper.to_findings(axe([rule(%{"nodes" => nodes, "nodes_total" => 30})]))

      assert length(findings) == 20
      assert Enum.all?(findings, &(&1.raw["nodes_total"] == 30))
    end

    test "nó com target_truncated não vira seletor" do
      [finding] =
        AxeMapper.to_findings(
          axe([rule(%{"nodes" => [node_result(%{"target_truncated" => true})]})])
        )

      assert finding.selector == nil
      assert finding.html_snippet == ~s(<img src="a.png">)
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

  describe "passed_rules/1 (RF-RA017)" do
    defp pass(id, tags \\ ["wcag2a", "wcag111"]),
      do: %{"id" => id, "tags" => tags, "help" => "Ajuda #{id}", "nodes_total" => 2}

    test "converte cada regra aprovada, com os critérios das tags e sem HTML" do
      axe = %{
        "violations" => [],
        "incomplete" => [],
        "passes" => [pass("image-alt"), pass("x", ["best-practice"])]
      }

      assert AxeMapper.passed_rules(axe) == [
               %{
                 "rule_id" => "image-alt",
                 "wcag_criteria" => ["1.1.1"],
                 "help" => "Ajuda image-alt",
                 "nodes_total" => 2
               },
               %{"rule_id" => "x", "wcag_criteria" => [], "help" => "Ajuda x", "nodes_total" => 2}
             ]
    end

    test "regra que também falhou (violations ou incomplete) não sai como aprovada" do
      axe = %{
        "violations" => [rule(%{"id" => "image-alt"})],
        "incomplete" => [rule(%{"id" => "color-contrast"})],
        "passes" => [pass("image-alt"), pass("color-contrast"), pass("document-title")]
      }

      assert [%{"rule_id" => "document-title"}] = AxeMapper.passed_rules(axe)
    end

    # O scanner descarta os nós sem `target` mínimo (`hasMinimumTarget`) e pode mandar a regra
    # com `nodes: []` e `nodes_total` > 0: ela não vira achado, mas continua sendo falha.
    test "regra com todos os nós descartados (nodes vazio) também não sai como aprovada" do
      axe = %{
        "violations" => [rule(%{"id" => "image-alt", "nodes" => [], "nodes_total" => 3})],
        "incomplete" => [],
        "passes" => [pass("image-alt"), pass("document-title")]
      }

      assert AxeMapper.to_findings(axe) == []
      assert [%{"rule_id" => "document-title"}] = AxeMapper.passed_rules(axe)
    end

    test "fixture de nós mistos (alt-misto): image-alt falha e passa; fica fora" do
      axe = scanner_response("alt-misto")["axe"]

      assert Enum.any?(axe["passes"], &(&1["id"] == "image-alt"))
      refute Enum.any?(AxeMapper.passed_rules(axe), &(&1["rule_id"] == "image-alt"))
    end

    test "sem passes é nil (não coletado); lista vazia é []; repetida sai uma vez" do
      assert AxeMapper.passed_rules(%{"violations" => [], "incomplete" => []}) == nil
      assert AxeMapper.passed_rules(%{"passes" => []}) == []
      assert [_] = AxeMapper.passed_rules(%{"passes" => [pass("a"), pass("a")]})
    end
  end

  describe "fit_passed_rules/2" do
    defp passed(i, help),
      do: %{
        "rule_id" => "r#{i}",
        "wcag_criteria" => ["1.1.1"],
        "help" => help,
        "nodes_total" => i
      }

    test "cabe: devolve a lista inteira" do
      rules = for i <- 1..3, do: passed(i, "x")
      assert AxeMapper.fit_passed_rules(rules, 65_536) == {rules, :ok}
      assert AxeMapper.fit_passed_rules(nil, 10) == {nil, :ok}
      assert AxeMapper.fit_passed_rules([], 10) == {[], :ok}
    end

    test "não cabe: corta do fim, mantendo a ordem" do
      rules = for i <- 1..10, do: passed(i, String.duplicate("a", 100))
      assert {kept, {:cut, n, 10}} = AxeMapper.fit_passed_rules(rules, 700)
      assert kept == Enum.take(rules, n) and n in 1..9
    end

    test "nem o primeiro item cabe: nil" do
      assert AxeMapper.fit_passed_rules([passed(1, String.duplicate("a", 100))], 50) ==
               {nil, {:dropped, 1}}
    end
  end
end
