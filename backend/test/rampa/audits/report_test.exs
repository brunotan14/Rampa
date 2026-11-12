defmodule Rampa.Audits.ReportTest do
  @moduledoc """
  Leituras do relatório (`Rampa.Audits.Report`, via `Rampa.Audits`): resumo com top 5
  (RF-RA005), páginas (RF-RA006), regras aprovadas (RF-RA017), detalhe de um achado
  (RF-RA007) e a lista de achados com os filtros e a ordem novos.
  """

  use Rampa.DataCase, async: true

  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias Rampa.Audits.{Page, PageTask, Report}

  @base ~U[2026-11-10 12:00:00.000000Z]

  defp axe_raw(nodes_total, help \\ "Ajuda do axe"),
    do: %{
      "help" => help,
      "helpUrl" => "https://dequeuniversity.com/x",
      "nodes_total" => nodes_total
    }

  describe "get_audit_summary/1 (RF-RA005)" do
    test "separa confirmados e a revisar por severidade; score nulo; sem achados, top vazio" do
      page = page_fixture(%{status: :done})
      finding_fixture(page, %{severity: :critical})
      finding_fixture(page, %{severity: :minor})
      finding_fixture(page, %{rule_id: "color-contrast", severity: :serious, needs_review: true})

      assert {:ok, summary} = Audits.get_audit_summary(page.audit_id)

      assert summary.totals_by_severity == %{critical: 1, serious: 0, moderate: 0, minor: 1}

      assert summary.needs_review_by_severity == %{
               critical: 0,
               serious: 1,
               moderate: 0,
               minor: 0
             }

      assert summary.needs_review_count == 1
      assert summary.audit.score == nil

      empty = page_fixture(%{status: :done})
      assert {:ok, %{top_issues: []}} = Audits.get_audit_summary(empty.audit_id)
      assert {:error, :audit_not_found} = Audits.get_audit_summary(Ecto.UUID.generate())
      assert {:error, :audit_not_found} = Audits.get_audit_summary("nao-e-uuid")
    end

    test "top 5: páginas afetadas, depois severidade, ocorrências e rule_id; sem revisão" do
      audit = audit_fixture()

      [p1, p2, p3] =
        for i <- 1..3,
            do: page_fixture(%{audit: audit, url: "https://exemplo.com/#{i}", status: :done})

      # `a-tres-paginas`: 3 páginas, moderada.
      for p <- [p1, p2, p3],
          do: finding_fixture(p, %{rule_id: "a-tres-paginas", severity: :moderate})

      # Duas regras em 2 páginas: a crítica vem antes da séria.
      for p <- [p1, p2], do: finding_fixture(p, %{rule_id: "z-critica", severity: :critical})
      for p <- [p1, p2], do: finding_fixture(p, %{rule_id: "b-seria", severity: :serious})
      # Duas regras em 1 página, mesma severidade: mais ocorrências primeiro.
      finding_fixture(p1, %{rule_id: "c-poucas", severity: :minor, raw: axe_raw(1)})
      finding_fixture(p1, %{rule_id: "d-muitas", severity: :minor, raw: axe_raw(40)})
      # Empate total com `d-muitas` (1 página, minor, 40): desempata pelo `rule_id`.
      finding_fixture(p1, %{rule_id: "e-muitas", severity: :minor, raw: axe_raw(40)})
      # Só a revisar: fica fora, por mais páginas que afete.
      for p <- [p1, p2, p3],
          do: finding_fixture(p, %{rule_id: "revisao", needs_review: true, source: :ai})

      assert {:ok, %{top_issues: top}} = Audits.get_audit_summary(audit.id)

      assert Enum.map(top, & &1.rule_id) ==
               ~w(a-tres-paginas z-critica b-seria d-muitas e-muitas)

      assert [%{pages_affected: 3, occurrences: 3, severity: :moderate} | _] = top
      assert Enum.at(top, 3).occurrences == 40
    end

    test "severidade e achado de exemplo são os mais graves da regra" do
      page = page_fixture(%{status: :done})
      finding_fixture(page, %{rule_id: "r", severity: :minor, inserted_at: @base})

      grave =
        finding_fixture(page, %{
          rule_id: "r",
          severity: :serious,
          inserted_at: DateTime.add(@base, 1),
          raw: axe_raw(2, "Ajuda do mais grave"),
          wcag_criteria: ["1.4.3"]
        })

      assert {:ok, %{top_issues: [issue]}} = Audits.get_audit_summary(page.audit_id)

      assert issue == %{
               rule_id: "r",
               help: "Ajuda do mais grave",
               wcag_criteria: ["1.4.3"],
               severity: :serious,
               pages_affected: 1,
               occurrences: 2,
               sample_finding_id: grave.id
             }
    end

    # Uma instrução só (no `READ COMMITTED`, um instante só): o resumo lido entre duas
    # gravações do `save_scan` não mistura a `revision` de uma com os totais da outra.
    test "revision, totais e top 5 vêm do mesmo instante, intercalando gravações" do
      stub_dns()
      {:ok, audit} = Audits.create_audit("https://exemplo.com/", %{ip_hash: "h"})
      [page] = Repo.all(from p in Page, where: p.audit_id == ^audit.id)

      assert {:ok, before} = Audits.get_audit_summary(audit.id)
      assert before.top_issues == []
      assert before.totals_by_severity.critical == 0

      {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      {:ok, _page} = Audits.record_scan_result(page, scanner_response("img-sem-alt"))

      assert {:ok, later} = Audits.get_audit_summary(audit.id)
      assert later.audit.revision > before.audit.revision
      assert later.totals_by_severity.critical == 1
      assert [%{rule_id: "image-alt", occurrences: 1}] = later.top_issues
      assert {:ok, progress} = Audits.get_progress(audit.id)
      assert progress.revision == later.audit.revision
      assert progress.progress.totals_by_severity == later.totals_by_severity
    end
  end

  describe "rule_occurrences/2" do
    test "violations e incomplete da mesma regra na mesma página contam separados" do
      page = page_fixture(%{status: :done})

      for _ <- 1..2,
          do:
            finding_fixture(page, %{
              rule_id: "color-contrast",
              severity: :serious,
              raw: axe_raw(2)
            })

      for _ <- 1..3,
          do:
            finding_fixture(page, %{
              rule_id: "color-contrast",
              severity: :serious,
              needs_review: true,
              raw: axe_raw(30)
            })

      rows = page.audit_id |> Report.rule_occurrences() |> Repo.all()

      assert %{occurrences: 2, findings: 2} = Enum.find(rows, &(not &1.needs_review))
      assert %{occurrences: 30, findings: 3} = Enum.find(rows, & &1.needs_review)

      assert {:ok, %{top_issues: [%{occurrences: 2}]}} = Audits.get_audit_summary(page.audit_id)
    end

    test "nodes_total menor que os achados, ausente ou absurdo não quebra a contagem" do
      page = page_fixture(%{status: :done})
      for _ <- 1..3, do: finding_fixture(page, %{rule_id: "a", raw: axe_raw(1)})
      finding_fixture(page, %{rule_id: "b", raw: nil})
      finding_fixture(page, %{rule_id: "c", raw: axe_raw(10_000_000_000_000)})

      rows =
        page.audit_id |> Report.rule_occurrences() |> Repo.all() |> Map.new(&{&1.rule_id, &1})

      assert rows["a"].occurrences == 3
      assert rows["b"].occurrences == 1
      assert rows["c"].occurrences == 1_000_000
    end
  end

  describe "list_pages/1 e get_page/2 (RF-RA006, RF-RA017)" do
    test "páginas na ordem de entrada, com contagens e passed_count" do
      audit = audit_fixture()

      done =
        page_fixture(%{
          audit: audit,
          url: "https://exemplo.com/a",
          status: :done,
          title: "A",
          passed_rules: [%{"rule_id" => "image-alt"}, %{"rule_id" => "document-title"}],
          inserted_at: ~U[2026-11-10 12:00:00Z]
        })

      failed =
        page_fixture(%{
          audit: audit,
          url: "https://exemplo.com/b",
          status: :failed,
          error: "timeout",
          inserted_at: ~U[2026-11-10 12:00:01Z]
        })

      finding_fixture(done, %{severity: :critical})
      finding_fixture(done, %{severity: :critical})
      finding_fixture(done, %{needs_review: true})

      assert {:ok, [first, second]} = Audits.list_pages(audit.id)
      assert first.page.id == done.id
      assert first.counts_by_severity == %{critical: 2, serious: 0, moderate: 0, minor: 0}
      assert first.needs_review_count == 1
      assert first.passed_count == 2
      # A lista não carrega as regras aprovadas inteiras.
      assert first.page.passed_rules == nil

      assert second.page.id == failed.id
      assert second.passed_count == nil
      assert second.counts_by_severity == %{critical: 0, serious: 0, moderate: 0, minor: 0}
    end

    test "auditoria sem página, inexistente e id inválido" do
      audit = audit_fixture()
      assert {:ok, []} = Audits.list_pages(audit.id)
      assert {:error, :audit_not_found} = Audits.list_pages(Ecto.UUID.generate())
      assert {:error, :audit_not_found} = Audits.list_pages("x")
    end

    test "get_page só encontra a página da própria auditoria" do
      page = page_fixture(%{status: :done, passed_rules: []})
      other = page_fixture(%{status: :done})

      assert {:ok, %{page: %Page{passed_rules: []}, passed_count: 0}} =
               Audits.get_page(page.audit_id, page.id)

      assert {:error, :page_not_found} = Audits.get_page(page.audit_id, other.id)
      assert {:error, :page_not_found} = Audits.get_page(page.audit_id, "x")
      assert {:error, :audit_not_found} = Audits.get_page(Ecto.UUID.generate(), page.id)
      assert {:error, :audit_not_found} = Audits.get_page("x", page.id)
    end
  end

  describe "get_finding/2 (RF-RA007)" do
    test "ocorrências na mesma lista do axe e outras páginas, da que tem mais para a que tem menos" do
      audit = audit_fixture()

      [p1, p2, p3] =
        for i <- 1..3,
            do:
              page_fixture(%{
                audit: audit,
                url: "https://exemplo.com/#{i}",
                status: :done,
                title: "P#{i}"
              })

      finding = finding_fixture(p1, %{rule_id: "image-alt", raw: axe_raw(3)})
      finding_fixture(p2, %{rule_id: "image-alt", raw: axe_raw(1)})
      finding_fixture(p3, %{rule_id: "image-alt", raw: axe_raw(7)})
      # Mesma regra, outra lista (incomplete): não conta.
      finding_fixture(p2, %{rule_id: "image-alt", needs_review: true, raw: axe_raw(50)})
      # Outra regra: não conta.
      finding_fixture(p1, %{rule_id: "link-name"})

      assert {:ok, detail} = Audits.get_finding(audit.id, finding.id)
      assert detail.finding.id == finding.id
      assert detail.page.id == p1.id
      assert detail.occurrences == %{page: 3, audit: 11}

      assert [%{page_id: id3, occurrences: 7, title: "P3"}, %{page_id: id2, occurrences: 1}] =
               detail.other_pages

      assert {id3, id2} == {p3.id, p2.id}
    end

    test "achado de outra auditoria, inexistente ou id inválido" do
      page = page_fixture(%{status: :done})
      other = page_fixture(%{status: :done})
      foreign = finding_fixture(other)

      assert {:error, :finding_not_found} = Audits.get_finding(page.audit_id, foreign.id)

      assert {:error, :finding_not_found} =
               Audits.get_finding(page.audit_id, Ecto.UUID.generate())

      assert {:error, :finding_not_found} = Audits.get_finding(page.audit_id, "x")
      assert {:error, :audit_not_found} = Audits.get_finding(Ecto.UUID.generate(), foreign.id)
      assert {:error, :audit_not_found} = Audits.get_finding("x", foreign.id)
    end
  end

  describe "list_findings/2: filtros, ordem e total" do
    setup do
      audit = audit_fixture()
      p1 = page_fixture(%{audit: audit, url: "https://exemplo.com/1", status: :done})
      p2 = page_fixture(%{audit: audit, url: "https://exemplo.com/2", status: :done})

      a =
        finding_fixture(p1, %{
          rule_id: "b",
          severity: :minor,
          wcag_criteria: ["1.4.3"],
          inserted_at: @base
        })

      b =
        finding_fixture(p1, %{
          rule_id: "a",
          severity: :critical,
          wcag_criteria: ["1.1.1", "4.1.2"],
          inserted_at: DateTime.add(@base, 1)
        })

      c =
        finding_fixture(p2, %{
          rule_id: "c",
          severity: :critical,
          wcag_criteria: ["1.4.3"],
          inserted_at: DateTime.add(@base, 2)
        })

      %{audit: audit, p1: p1, p2: p2, a: a, b: b, c: c}
    end

    test "page_id e wcag filtram; total conta os filtrados", ctx do
      ids = fn params ->
        {:ok, %{data: data, total: total}} = Audits.list_findings(ctx.audit.id, params)
        {Enum.map(data, & &1.id), total}
      end

      assert ids.(%{"page_id" => ctx.p1.id}) == {[ctx.a.id, ctx.b.id], 2}
      assert ids.(%{"wcag" => "1.4.3"}) == {[ctx.a.id, ctx.c.id], 2}
      assert ids.(%{"wcag" => "4.1.2", "page_id" => ctx.p1.id}) == {[ctx.b.id], 1}
      assert ids.(%{"limit" => "1"}) == {[ctx.a.id], 3}

      # Página de outra auditoria: lista vazia, sem dizer se ela existe.
      foreign = page_fixture(%{status: :done})
      finding_fixture(foreign)
      assert ids.(%{"page_id" => foreign.id}) == {[], 0}
    end

    test "valores inválidos de page_id, wcag e sort", ctx do
      for params <- [
            %{"page_id" => "x"},
            %{"page_id" => ["x"]},
            %{"wcag" => "1.4"},
            %{"wcag" => "5.1.1"},
            %{"wcag" => "1.4.3 "},
            %{"wcag" => "1.4.333"}
          ] do
        assert Audits.list_findings(ctx.audit.id, params) == {:error, :invalid_filter},
               inspect(params)
      end

      for sort <- ["x", "", ["severity"]] do
        assert Audits.list_findings(ctx.audit.id, %{"sort" => sort}) == {:error, :invalid_sort}
      end
    end

    test "sort=severity: mais grave primeiro, depois rule_id", ctx do
      {:ok, %{data: data}} = Audits.list_findings(ctx.audit.id, %{"sort" => "severity"})
      assert Enum.map(data, & &1.id) == [ctx.b.id, ctx.c.id, ctx.a.id]
    end

    test "cursor de uma ordem não vale na outra", ctx do
      {:ok, %{next_cursor: severity}} =
        Audits.list_findings(ctx.audit.id, %{"sort" => "severity", "limit" => "1"})

      {:ok, %{next_cursor: recorded}} = Audits.list_findings(ctx.audit.id, %{"limit" => "1"})

      assert {:error, :invalid_cursor} =
               Audits.list_findings(ctx.audit.id, %{"cursor" => severity})

      assert {:error, :invalid_cursor} =
               Audits.list_findings(ctx.audit.id, %{"sort" => "severity", "cursor" => recorded})
    end

    test "âncora inexistente, de outra auditoria ou longa demais é cursor inválido", ctx do
      foreign = page_fixture(%{status: :done}) |> finding_fixture()

      for id <- [Ecto.UUID.generate(), foreign.id] do
        cursor = Base.url_encode64("severity:" <> id, padding: false)

        assert {:error, :invalid_cursor} =
                 Audits.list_findings(ctx.audit.id, %{"sort" => "severity", "cursor" => cursor})
      end

      long = String.duplicate("A", 257)

      assert {:error, :invalid_cursor} =
               Audits.list_findings(ctx.audit.id, %{"sort" => "severity", "cursor" => long})
    end

    # O `rule_id` vem da página auditada e não entra no cursor: com 128 caracteres de 4
    # bytes e `:` no meio, a paginação por âncora continua indo até o fim, na ordem.
    test "sort=severity pagina até o fim com rule_id longo, de 4 bytes e com ':'" do
      page = page_fixture(%{status: :done})

      long = fn suffix ->
        String.duplicate("😀", 121) <> ":#{suffix}:" <> String.duplicate("𝄞", 4)
      end

      spec =
        for {rule, severity, offset} <- [
              {long.("b"), :critical, 0},
              {long.("a"), :critical, 1},
              {long.("a"), :critical, 1},
              {long.("a"), :minor, 0},
              {"x", :serious, 3}
            ] do
          finding_fixture(page, %{
            rule_id: rule,
            severity: severity,
            inserted_at: DateTime.add(@base, offset)
          })
        end

      assert String.length(hd(spec).rule_id) == 128

      expected =
        spec
        |> Enum.sort_by(fn f ->
          {Enum.find_index(~w(critical serious moderate minor)a, &(&1 == f.severity)), f.rule_id,
           DateTime.to_unix(f.inserted_at, :microsecond), f.id}
        end)
        |> Enum.map(& &1.id)

      assert page_through(page.audit_id, %{"sort" => "severity", "limit" => "2"}) == expected
    end
  end

  describe "regras aprovadas na gravação (RF-RA017)" do
    test "limpa.html: a lista tem image-alt; a regra que também falhou fica fora" do
      page = scanned_page("limpa")
      assert {:ok, %{page: %Page{passed_rules: rules}}} = Audits.get_page(page.audit_id, page.id)

      assert %{"rule_id" => "image-alt", "wcag_criteria" => ["1.1.1"], "nodes_total" => 1} =
               Enum.find(rules, &(&1["rule_id"] == "image-alt"))

      # Nada da página, nenhum nó: só os quatro campos.
      assert Enum.all?(
               rules,
               &(Map.keys(&1) |> Enum.sort() == ~w(help nodes_total rule_id wcag_criteria))
             )

      mixed = scanned_page("alt-misto")
      {:ok, %{page: %Page{passed_rules: rules}}} = Audits.get_page(mixed.audit_id, mixed.id)
      refute Enum.any?(rules, &(&1["rule_id"] == "image-alt"))
      assert Enum.any?(rules, &(&1["rule_id"] == "document-title"))
    end

    test "sem axe.passes grava nil, e uma nova varredura sem passes apaga a lista anterior" do
      page =
        scanned_page("img-sem-alt", fn r -> update_in(r, ["axe"], &Map.delete(&1, "passes")) end)

      assert %Page{passed_rules: nil} = Repo.get!(Page, page.id)

      page = scanned_page("limpa")
      assert [_ | _] = Repo.get!(Page, page.id).passed_rules

      # Nova tentativa (a tarefa reaberta) com um scanner sem `passes`.
      reopen_scan(page)

      without = update_in(scanner_response("limpa"), ["axe"], &Map.delete(&1, "passes"))
      assert {:ok, _} = Audits.record_scan_result(page, without)
      assert %Page{passed_rules: nil} = Repo.get!(Page, page.id)
    end

    test "gravar de novo não duplica a lista" do
      page = scanned_page("limpa")
      first = Repo.get!(Page, page.id).passed_rules

      reopen_scan(page)

      assert {:ok, _} = Audits.record_scan_result(page, scanner_response("limpa"))
      assert Repo.get!(Page, page.id).passed_rules == first
    end
  end

  defp page_through(audit_id, params, cursor \\ nil, acc \\ []) do
    params = if cursor, do: Map.put(params, "cursor", cursor), else: params
    assert {:ok, %{data: data, next_cursor: next}} = Audits.list_findings(audit_id, params)
    acc = acc ++ Enum.map(data, & &1.id)
    if next, do: page_through(audit_id, Map.delete(params, "cursor"), next, acc), else: acc
  end

  defp stub_dns,
    do:
      Mox.stub(Rampa.Security.ResolverMock, :resolve, fn _host -> {:ok, [{93, 184, 215, 14}]} end)

  # Página `scanning` numa auditoria que continua aberta depois da gravação (outra página
  # ainda na fila), para dar para gravar de novo (nova tentativa).
  defp scanned_page(fixture, transform \\ & &1) do
    audit = audit_fixture(%{status: :running})

    page =
      page_fixture(%{audit: audit, url: "https://exemplo.com/#{fixture}.html", status: :scanning})

    page_fixture(%{audit: audit, url: "https://exemplo.com/na-fila", status: :queued})
    {:ok, _page} = Audits.record_scan_result(page, transform.(scanner_response(fixture)))
    page
  end

  defp reopen_scan(page) do
    Repo.update_all(from(t in PageTask, where: t.page_id == ^page.id),
      set: [status: :running, finished_at: nil]
    )
  end
end
