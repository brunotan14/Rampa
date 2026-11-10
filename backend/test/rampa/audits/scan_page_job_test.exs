defmodule Rampa.Audits.ScanPageJobTest do
  use Rampa.DataCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Mox
  import Rampa.AuditsFixtures

  alias Rampa.Audits.{Audit, Finding, Page, ScanPageJob}
  alias Rampa.Scanner.ClientMock

  setup :verify_on_exit!

  defp expect_scan(page, response) do
    expect(ClientMock, :scan, fn url ->
      assert url == page.url
      response
    end)
  end

  defp findings(page), do: Repo.all(from f in Finding, where: f.page_id == ^page.id)

  defp reload(%Page{} = page), do: Repo.get!(Page, page.id)
  defp reload(%Audit{} = audit), do: Repo.get!(Audit, audit.id)

  defp audit_of(page), do: Repo.get!(Audit, page.audit_id)

  test "usa a fila scan com duas tentativas" do
    assert %{queue: "scan", max_attempts: 2} =
             ScanPageJob.new(%{"page_id" => Ecto.UUID.generate()}).changes
  end

  describe "RF-RA003: img-sem-alt.html" do
    setup do
      page = page_fixture(%{url: "http://fixtures/img-sem-alt.html"})
      expect_scan(page, {:ok, scanner_response("img-sem-alt")})
      assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})
      %{page: page}
    end

    test "existe achado image-alt com critério 1.1.1, severidade crítica e sem revisão", %{
      page: page
    } do
      assert [finding] = findings(page)

      assert %Finding{
               source: :axe,
               rule_id: "image-alt",
               severity: :critical,
               needs_review: false,
               confidence: nil,
               selector: "img",
               audit_id: audit_id
             } = finding

      assert audit_id == page.audit_id
      assert "1.1.1" in finding.wcag_criteria
      assert finding.html_snippet =~ ~r/^<img /
      assert finding.raw["helpUrl"] =~ "image-alt"
    end

    test "grava os fatos da página", %{page: page} do
      page = reload(page)

      assert %Page{
               status: :done,
               error: nil,
               final_url: "http://127.0.0.1:8099/img-sem-alt.html",
               http_status: 200,
               title: "Imagem sem texto alternativo",
               axe_version: "4.14.0"
             } = page

      assert %DateTime{} = page.scanned_at
    end

    test "conclui a auditoria de uma página", %{page: page} do
      audit = audit_of(page)

      assert %Audit{status: :completed, pages_scanned: 1, pages_failed: 0, error: nil, score: nil} =
               audit

      assert %DateTime{} = audit.started_at
      assert %DateTime{} = audit.finished_at
    end
  end

  test "RF-RA003: limpa.html não gera achado com needs_review = false" do
    page = page_fixture(%{url: "http://fixtures/limpa.html"})
    expect_scan(page, {:ok, scanner_response("limpa")})

    assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})

    assert Repo.all(from f in Finding, where: f.page_id == ^page.id and not f.needs_review) == []
    assert %Page{status: :done, title: "Página limpa"} = reload(page)
    assert %Audit{status: :completed, pages_scanned: 1} = audit_of(page)
  end

  test "incomplete do axe vira achado com needs_review = true" do
    page = page_fixture(%{url: "http://fixtures/contraste-incerto.html"})
    expect_scan(page, {:ok, scanner_response("contraste-incerto")})

    assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})

    assert [
             %Finding{
               rule_id: "color-contrast",
               source: :axe,
               needs_review: true,
               wcag_criteria: ["1.4.3"]
             }
           ] =
             findings(page)
  end

  test "rodar duas vezes não duplica achados nem contadores e preserva achados de outras fontes" do
    page = page_fixture(%{url: "http://fixtures/img-sem-alt.html"})

    other =
      Repo.insert!(%Finding{
        page_id: page.id,
        audit_id: page.audit_id,
        source: :ai,
        rule_id: "rampa-alt-inadequate",
        severity: :serious,
        needs_review: true,
        confidence: 0.9
      })

    expect(ClientMock, :scan, 2, fn _url -> {:ok, scanner_response("img-sem-alt")} end)

    assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})
    assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})

    findings = findings(page)
    assert length(findings) == 2
    assert [%Finding{rule_id: "image-alt"}] = Enum.filter(findings, &(&1.source == :axe))
    assert Enum.any?(findings, &(&1.id == other.id))
    assert %Audit{status: :completed, pages_scanned: 1, pages_failed: 0} = audit_of(page)
  end

  test "não sobrescreve started_at de auditoria já iniciada" do
    started_at = ~U[2026-11-10 12:00:00Z]
    audit = audit_fixture(%{status: :running, started_at: started_at})
    page = page_fixture(%{audit: audit})
    expect_scan(page, {:ok, scanner_response("limpa")})

    assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})

    assert %Audit{started_at: ^started_at, status: :completed} = reload(audit)
  end

  test "corta o trecho de HTML em 2 KB sem quebrar caractere" do
    page = page_fixture()
    long_html = "<p>" <> String.duplicate("ação ", 1_000) <> "</p>"

    response =
      update_in(scanner_response("img-sem-alt"), ["axe", "violations"], fn [rule] ->
        [update_in(rule, ["nodes"], fn [node] -> [Map.put(node, "html", long_html)] end)]
      end)

    expect_scan(page, {:ok, response})

    assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})

    assert [%Finding{html_snippet: snippet}] = findings(page)
    assert byte_size(snippet) <= 2048
    assert byte_size(snippet) > 2044
    assert String.valid?(snippet)
    assert String.starts_with?(long_html, snippet)
  end

  test "marca a página scanning e a auditoria running enquanto o scanner trabalha" do
    page = page_fixture()

    expect(ClientMock, :scan, fn _url ->
      assert %Page{status: :scanning} = reload(page)
      assert %Audit{status: :running, started_at: %DateTime{}} = audit_of(page)
      {:ok, scanner_response("limpa")}
    end)

    assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})
  end

  describe "erros definitivos" do
    for code <- [:blocked_address, :http_error] do
      @tag :capture_log
      test "#{code} marca a página e a auditoria como falhas e cancela o job" do
        code = unquote(code)
        page = page_fixture()
        expect_scan(page, {:error, %{code: code, detail: "detalhe"}})

        assert {:cancel, ^code} = perform_job(ScanPageJob, %{"page_id" => page.id})

        error = Atom.to_string(code)
        assert %Page{status: :failed, error: ^error} = reload(page)

        assert %Audit{status: :failed, error: ^error, pages_failed: 1, pages_scanned: 0} =
                 audit = audit_of(page)

        assert %DateTime{} = audit.finished_at
        assert findings(page) == []
      end
    end
  end

  describe "erros passageiros" do
    for code <- [:timeout, :navigation_failed, :unavailable] do
      @tag :capture_log
      test "#{code} tenta de novo sem marcar falha na primeira tentativa" do
        code = unquote(code)
        page = page_fixture()
        expect_scan(page, {:error, %{code: code, detail: "detalhe"}})

        assert {:error, ^code} = perform_job(ScanPageJob, %{"page_id" => page.id}, attempt: 1)

        assert %Page{status: :scanning, error: nil} = reload(page)
        assert %Audit{status: :running, pages_failed: 0, finished_at: nil} = audit_of(page)
      end

      @tag :capture_log
      test "#{code} marca falha na última tentativa" do
        code = unquote(code)
        page = page_fixture()
        expect_scan(page, {:error, %{code: code, detail: "detalhe"}})

        assert {:error, ^code} = perform_job(ScanPageJob, %{"page_id" => page.id}, attempt: 2)

        error = Atom.to_string(code)
        assert %Page{status: :failed, error: ^error} = reload(page)
        assert %Audit{status: :failed, error: ^error, pages_failed: 1} = audit_of(page)
      end
    end

    @tag :capture_log
    test "a segunda tentativa que dá certo conclui a auditoria" do
      page = page_fixture()
      expect_scan(page, {:error, %{code: :timeout, detail: "detalhe"}})
      assert {:error, :timeout} = perform_job(ScanPageJob, %{"page_id" => page.id}, attempt: 1)

      expect_scan(page, {:ok, scanner_response("img-sem-alt")})
      assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id}, attempt: 2)

      assert %Page{status: :done, error: nil} = reload(page)

      assert %Audit{status: :completed, pages_scanned: 1, pages_failed: 0, error: nil} =
               audit_of(page)
    end
  end

  test "página inexistente cancela o job sem chamar o scanner" do
    assert {:cancel, :page_not_found} =
             perform_job(ScanPageJob, %{"page_id" => Ecto.UUID.generate()})

    assert {:cancel, :page_not_found} = perform_job(ScanPageJob, %{"page_id" => "nao-e-uuid"})
  end
end
