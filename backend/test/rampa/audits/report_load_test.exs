defmodule Rampa.Audits.ReportLoadTest do
  @moduledoc """
  Orçamento de desempenho das leituras do relatório numa auditoria no pior caso teórico do
  contrato: 25 páginas × 200 regras (100 em `violations`, 100 em `incomplete`) × 20 nós =
  100 mil achados, com as regras aprovadas em cada página.

  Mede o `GET` do resumo (top 5 e totais), o `GET /pages` e o detalhe de um achado (com
  "onde mais aparece"), pela API, 30 vezes cada, e confere o p95.

  Fica **fora da execução padrão** (`@moduletag :load`, excluída em `test_helper.exs`): só a
  carga dos 100 mil achados leva alguns segundos, e o tempo das consultas num runner
  compartilhado do CI varia demais para servir de teto confiável. Roda com
  `mix test --only load` (ou `make test-load`), localmente e antes de mexer nas consultas do
  relatório; o teto aqui é o alvo local (`@p95_budget_ms`).
  """

  use RampaWeb.ConnCase, async: false

  import Ecto.Query
  import Rampa.AuditsFixtures

  alias Rampa.Audits.Finding
  alias Rampa.Repo

  @moduletag :load
  @moduletag timeout: :timer.minutes(5)

  @pages 25
  @rules_per_list 100
  @nodes 20
  @runs 30
  @p95_budget_ms 50
  @severities ~w(critical serious moderate minor)a

  test "resumo, páginas e detalhe ficam dentro do orçamento com 100 mil achados" do
    audit = audit_fixture(%{status: :completed, pages_found: @pages, pages_scanned: @pages})

    passed =
      for i <- 1..70,
          do: %{
            "rule_id" => "aprovada-#{i}",
            "wcag_criteria" => ["1.1.1"],
            "help" => "Ajuda da regra aprovada #{i}",
            "nodes_total" => 3
          }

    pages =
      for i <- 1..@pages do
        page_fixture(%{
          audit: audit,
          url: "https://exemplo.com/pagina-#{i}",
          status: :done,
          title: "Página #{i}",
          passed_rules: passed
        })
      end

    now = DateTime.utc_now()

    rows =
      for page <- pages,
          needs_review <- [false, true],
          rule <- 1..@rules_per_list,
          node <- 1..@nodes do
        %{
          id: Ecto.UUID.generate(),
          page_id: page.id,
          audit_id: audit.id,
          source: :axe,
          rule_id: "regra-#{rule}",
          wcag_criteria: ["1.4.3"],
          severity: Enum.at(@severities, rem(rule, 4)),
          needs_review: needs_review,
          selector: "#no-#{node}",
          html_snippet: String.duplicate("<div>", 40),
          message: "Mensagem do axe",
          raw: %{
            "help" => "Ajuda",
            "helpUrl" => "https://dequeuniversity.com/x",
            "nodes_total" => 35
          },
          inserted_at: DateTime.add(now, node, :microsecond),
          updated_at: now
        }
      end

    {load_us, _} =
      :timer.tc(fn ->
        rows |> Enum.chunk_every(2_000) |> Enum.each(&Repo.insert_all(Finding, &1))
      end)

    assert Repo.aggregate(from(f in Finding, where: f.audit_id == ^audit.id), :count) == 100_000
    Repo.query!("ANALYZE findings")
    Repo.query!("ANALYZE pages")

    finding = Repo.one!(from f in Finding, where: f.audit_id == ^audit.id, limit: 1)

    timings = %{
      "GET /api/audits/:id" => measure(~p"/api/audits/#{audit.id}"),
      "GET /api/audits/:id/pages" => measure(~p"/api/audits/#{audit.id}/pages"),
      "GET /api/audits/:id/findings/:id" =>
        measure(~p"/api/audits/#{audit.id}/findings/#{finding.id}"),
      "GET /api/audits/:id/findings?sort=severity" =>
        measure(~p"/api/audits/#{audit.id}/findings?sort=severity&limit=50")
    }

    IO.puts("\ncarga de 100 mil achados: #{div(load_us, 1000)} ms")

    for {route, {p50, p95}} <- timings do
      IO.puts("#{route}: p50 #{p50} ms, p95 #{p95} ms (#{@runs} execuções)")
    end

    for {route, {_p50, p95}} <- timings do
      assert p95 < @p95_budget_ms, "#{route}: p95 de #{p95} ms, acima de #{@p95_budget_ms} ms"
    end
  end

  # Uma requisição de aquecimento e `@runs` medidas; devolve p50 e p95 em milissegundos.
  defp measure(path) do
    build_conn() |> get(path) |> json_response(200)

    samples =
      for _ <- 1..@runs do
        {us, conn} = :timer.tc(fn -> build_conn() |> get(path) end)
        assert conn.status == 200
        us / 1000
      end
      |> Enum.sort()

    {percentile(samples, 0.5), percentile(samples, 0.95)}
  end

  defp percentile(sorted, p) do
    index = max(ceil(p * length(sorted)) - 1, 0)
    sorted |> Enum.at(index) |> Float.round(1)
  end
end
