defmodule Rampa.Audits.ScanPageJobTest do
  use Rampa.DataCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Mox
  import Rampa.AuditsFixtures

  alias Rampa.Audits.{Audit, Finding, Page, PageTask, ScanPageJob}
  alias Rampa.Scanner.ClientMock
  alias Rampa.Security.ResolverMock

  setup :verify_on_exit!

  # As URLs das páginas passam pelo `URLGuard` antes do scanner: o DNS mockado resolve
  # tudo para um IP público, salvo nos testes de recusa.
  setup do
    stub(ResolverMock, :resolve, fn _host -> {:ok, [{93, 184, 215, 14}]} end)
    :ok
  end

  defp expect_scan(page, response) do
    expect(ClientMock, :scan, fn url ->
      assert url == page.url
      response
    end)
  end

  defp perform(page, opts \\ []),
    do: perform_job(ScanPageJob, %{"page_id" => page.id}, opts)

  defp findings(page), do: Repo.all(from f in Finding, where: f.page_id == ^page.id)

  defp reload(%Page{} = page), do: Repo.get!(Page, page.id)
  defp reload(%Audit{} = audit), do: Repo.get!(Audit, audit.id)

  defp audit_of(page), do: Repo.get!(Audit, page.audit_id)

  defp scan_task(page), do: Repo.get_by!(PageTask, page_id: page.id, kind: :scan)

  # Resposta real de img-sem-alt com o único nó trocado.
  defp with_node(fun) do
    update_in(scanner_response("img-sem-alt"), ["axe", "violations"], fn [rule] ->
      [update_in(rule, ["nodes"], fn [node] -> [fun.(node)] end)]
    end)
  end

  describe "configuração" do
    test "fila scan, duas tentativas e um job por página" do
      page_id = Ecto.UUID.generate()
      assert %{queue: "scan", max_attempts: 2} = ScanPageJob.new(%{"page_id" => page_id}).changes

      assert {:ok, first} = Oban.insert(ScanPageJob.new(%{"page_id" => page_id}))
      assert {:ok, second} = Oban.insert(ScanPageJob.new(%{"page_id" => page_id}))
      assert second.conflict?
      assert second.id == first.id

      assert {:ok, other} = Oban.insert(ScanPageJob.new(%{"page_id" => Ecto.UUID.generate()}))
      refute other.conflict?
    end
  end

  describe "RF-RA003: img-sem-alt.html" do
    setup do
      page = page_fixture(%{url: "https://exemplo.com/img-sem-alt.html"})
      expect_scan(page, {:ok, scanner_response("img-sem-alt")})
      assert :ok = perform(page)
      %{page: page}
    end

    test "existe achado image-alt com critério 1.1.1, severidade crítica e sem revisão",
         %{page: page} do
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
               final_url: "https://exemplo.com/img-sem-alt.html",
               http_status: 200,
               title: "Imagem sem texto alternativo",
               axe_version: "4.14.0"
             } = page

      assert %DateTime{} = page.scanned_at
    end

    test "conclui a auditoria de uma página", %{page: page} do
      audit = audit_of(page)

      assert %Audit{
               status: :completed,
               pages_scanned: 1,
               pages_failed: 0,
               error: nil,
               score: nil
             } = audit

      assert %DateTime{} = audit.started_at
      assert %DateTime{} = audit.finished_at
    end
  end

  test "RF-RA003: limpa.html não gera achado com needs_review = false" do
    page = page_fixture(%{url: "https://exemplo.com/limpa.html"})
    expect_scan(page, {:ok, scanner_response("limpa")})

    assert :ok = perform(page)

    assert Repo.all(from f in Finding, where: f.page_id == ^page.id and not f.needs_review) == []
    assert %Page{status: :done, title: "Página limpa"} = reload(page)
    assert %Audit{status: :completed, pages_scanned: 1} = audit_of(page)
  end

  test "incomplete do axe vira achado com needs_review = true" do
    page = page_fixture(%{url: "https://exemplo.com/contraste-incerto.html"})
    expect_scan(page, {:ok, scanner_response("contraste-incerto")})

    assert :ok = perform(page)

    assert [
             %Finding{
               rule_id: "color-contrast",
               source: :axe,
               needs_review: true,
               wcag_criteria: ["1.4.3"]
             }
           ] = findings(page)
  end

  describe "repetição" do
    test "o job repetido numa página já varrida não chama o scanner nem duplica nada" do
      page = page_fixture()
      expect_scan(page, {:ok, scanner_response("img-sem-alt")})

      assert :ok = perform(page)
      assert {:cancel, :already_finished} = perform(page)

      assert [%Finding{rule_id: "image-alt"}] = findings(page)
      assert %Audit{status: :completed, pages_scanned: 1, pages_failed: 0} = audit_of(page)
    end

    test "varrer de novo uma página regrava os achados do axe e preserva os de outras fontes" do
      page = page_fixture()

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
      assert :ok = perform(page)

      # Como se a página voltasse a ficar pendente (ex.: o job caiu depois de gravar).
      Repo.update_all(from(p in Page, where: p.id == ^page.id), set: [status: :scanning])

      Repo.update_all(from(t in PageTask, where: t.page_id == ^page.id),
        set: [status: :running, finished_at: nil]
      )

      Repo.update_all(from(a in Audit, where: a.id == ^page.audit_id), set: [status: :running])
      assert :ok = perform(page)

      findings = findings(page)
      assert length(findings) == 2
      assert [%Finding{rule_id: "image-alt"}] = Enum.filter(findings, &(&1.source == :axe))
      assert Enum.any?(findings, &(&1.id == other.id))
      assert %Audit{status: :completed, pages_scanned: 1, pages_failed: 0} = audit_of(page)
    end
  end

  describe "estado final" do
    for status <- [:completed, :failed, :cancelled] do
      test "auditoria #{status} não é varrida nem alterada" do
        status = unquote(status)
        audit = audit_fixture(%{status: status})
        page = page_fixture(%{audit: audit})

        assert {:cancel, :already_finished} = perform(page)

        assert reload(audit) == audit
        assert %Page{status: :queued} = reload(page)
        assert %PageTask{status: :pending, attempt: 0} = scan_task(page)
      end
    end

    for status <- [:done, :failed] do
      test "página #{status} não é varrida de novo" do
        status = unquote(status)
        page = page_fixture(%{status: status})

        assert {:cancel, :already_finished} = perform(page)

        assert %Page{status: ^status} = reload(page)
        assert %Audit{status: :queued} = audit_of(page)
      end
    end

    test "auditoria cancelada durante a varredura não recebe o resultado" do
      page = page_fixture()

      expect(ClientMock, :scan, fn _url ->
        Repo.update_all(from(a in Audit, where: a.id == ^page.audit_id),
          set: [status: :cancelled]
        )

        {:ok, scanner_response("img-sem-alt")}
      end)

      assert {:cancel, :already_finished} = perform(page)

      assert %Audit{status: :cancelled, pages_scanned: 0, finished_at: nil} = audit_of(page)
      assert findings(page) == []
    end

    @tag :capture_log
    test "auditoria cancelada durante a varredura não vira failed na última tentativa" do
      page = page_fixture()

      expect(ClientMock, :scan, fn _url ->
        Repo.update_all(from(a in Audit, where: a.id == ^page.audit_id),
          set: [status: :cancelled]
        )

        {:error, %{code: :timeout, detail: "detalhe"}}
      end)

      assert {:error, :timeout} = perform(page, attempt: 2)

      assert %Audit{status: :cancelled, pages_failed: 0} = audit_of(page)
      assert %Page{status: :scanning} = reload(page)
    end
  end

  test "não sobrescreve started_at de auditoria já iniciada" do
    started_at = ~U[2026-11-10 12:00:00Z]
    audit = audit_fixture(%{status: :running, started_at: started_at})
    page = page_fixture(%{audit: audit})
    expect_scan(page, {:ok, scanner_response("limpa")})

    assert :ok = perform(page)

    assert %Audit{started_at: ^started_at, status: :completed} = reload(audit)
  end

  test "marca a página scanning e a auditoria running enquanto o scanner trabalha" do
    page = page_fixture()

    expect(ClientMock, :scan, fn _url ->
      assert %Page{status: :scanning} = reload(page)
      assert %Audit{status: :running, started_at: %DateTime{}} = audit_of(page)
      {:ok, scanner_response("limpa")}
    end)

    assert :ok = perform(page)
  end

  describe "dados vindos da página" do
    test "corta o trecho de HTML em 2 KB sem quebrar caractere" do
      page = page_fixture()
      long_html = "<p>" <> String.duplicate("ação ", 1_000) <> "</p>"
      expect_scan(page, {:ok, with_node(&Map.put(&1, "html", long_html))})

      assert :ok = perform(page)

      assert [%Finding{html_snippet: snippet}] = findings(page)
      assert byte_size(snippet) <= 2048
      assert byte_size(snippet) > 2044
      assert String.valid?(snippet)
      assert String.starts_with?(long_html, snippet)
    end

    test "remove NUL antes de gravar página e achado" do
      page = page_fixture()

      response =
        with_node(fn node ->
          %{
            node
            | "html" => "<img\u0000 src=x>",
              "failureSummary" => "Fix\u0000 any",
              "target" => [["#ho\u0000st", "img"]]
          }
        end)
        |> Map.merge(%{
          "title" => "Tí\u0000tulo",
          "final_url" => "https://exemplo.com/a\u0000b.html"
        })
        |> update_in(["axe", "violations"], fn [rule] ->
          [%{rule | "help" => "Images\u0000 must", "tags" => ["wcag2a", "wcag\u0000111"]}]
        end)

      expect_scan(page, {:ok, response})

      assert :ok = perform(page)

      assert %Page{title: "Título", final_url: "https://exemplo.com/ab.html"} = reload(page)

      assert [finding] = findings(page)
      assert finding.html_snippet == "<img src=x>"
      assert finding.message == "Fix any"
      assert finding.selector == "#host >> img"
      assert finding.raw["help"] == "Images must"
      assert finding.raw["tags"] == ["wcag2a", "wcag111"]
      assert finding.wcag_criteria == ["1.1.1"]
    end

    test "corta o título em 512 bytes sem quebrar caractere" do
      page = page_fixture()
      title = String.duplicate("é", 300)
      expect_scan(page, {:ok, Map.put(scanner_response("limpa"), "title", title)})

      assert :ok = perform(page)

      assert %Page{title: stored} = reload(page)
      assert byte_size(stored) == 512
      assert stored == String.duplicate("é", 256)
    end
  end

  describe "erros definitivos" do
    for code <- [
          :blocked_address,
          :invalid_url,
          :resource_limit,
          :http_error,
          :invalid_request,
          :invalid_scan_result
        ] do
      @tag :capture_log
      test "#{code} marca a página e a auditoria como falhas e cancela o job" do
        code = unquote(code)
        page = page_fixture()
        expect_scan(page, {:error, %{code: code, detail: "detalhe"}})

        assert {:cancel, ^code} = perform(page, attempt: 1)

        error = Atom.to_string(code)
        assert %Page{status: :failed, error: ^error} = reload(page)

        assert %Audit{status: :failed, error: ^error, pages_failed: 1, pages_scanned: 0} =
                 audit = audit_of(page)

        assert %DateTime{} = audit.finished_at
        assert findings(page) == []
      end
    end
  end

  describe "erros passageiros do scanner" do
    for code <- [:timeout, :navigation_failed, :analysis_failed, :unavailable, :contract_mismatch] do
      @tag :capture_log
      test "#{code} tenta de novo sem marcar falha na primeira tentativa" do
        code = unquote(code)
        page = page_fixture()
        expect_scan(page, {:error, %{code: code, detail: "detalhe"}})

        assert {:error, ^code} = perform(page, attempt: 1)

        assert %Page{status: :scanning, error: nil} = reload(page)
        assert %Audit{status: :running, pages_failed: 0, finished_at: nil} = audit_of(page)
      end

      @tag :capture_log
      test "#{code} marca falha na última tentativa" do
        code = unquote(code)
        page = page_fixture()
        expect_scan(page, {:error, %{code: code, detail: "detalhe"}})

        assert {:cancel, ^code} = perform(page, attempt: 2)

        error = Atom.to_string(code)
        assert %Page{status: :failed, error: ^error} = reload(page)
        assert %Audit{status: :failed, error: ^error, pages_failed: 1} = audit_of(page)
      end
    end

    @tag :capture_log
    test "a segunda tentativa que dá certo conclui a auditoria" do
      page = page_fixture()
      expect_scan(page, {:error, %{code: :timeout, detail: "detalhe"}})
      assert {:error, :timeout} = perform(page, attempt: 1)

      expect_scan(page, {:ok, scanner_response("img-sem-alt")})
      assert :ok = perform(page, attempt: 2)

      assert %Page{status: :done, error: nil} = reload(page)

      assert %Audit{status: :completed, pages_scanned: 1, pages_failed: 0, error: nil} =
               audit_of(page)
    end
  end

  # Gravação recusada é definitiva: com o resultado já validado pelo contrato, o mesmo
  # resultado seria recusado de novo.
  describe "gravação recusada" do
    @tag :capture_log
    test "achado inválido não grava nada e marca a falha na primeira tentativa" do
      page = page_fixture()
      expect_scan(page, {:ok, invalid_response()})

      assert {:cancel, :invalid_scan_result} = perform(page, attempt: 1)

      assert %Page{status: :failed, error: "invalid_scan_result", axe_version: nil} =
               reload(page)

      assert %Audit{status: :failed, error: "invalid_scan_result"} = audit_of(page)
      assert findings(page) == []
    end

    @tag :capture_log
    test "resultado sem o campo axe também é recusado" do
      page = page_fixture()
      expect_scan(page, {:ok, Map.delete(scanner_response("limpa"), "axe")})

      assert {:cancel, :invalid_scan_result} = perform(page, attempt: 1)

      assert %Page{status: :failed, error: "invalid_scan_result"} = reload(page)
    end

    # Regra sem `id`: o changeset do achado recusa.
    defp invalid_response do
      update_in(scanner_response("img-sem-alt"), ["axe", "violations"], fn [rule] ->
        [Map.delete(rule, "id")]
      end)
    end
  end

  # Item do review: só a recusa causada pelos dados do scanner (achado inválido) é definitiva;
  # os outros erros da gravação são do banco ou do ciclo de vida e ganham nova tentativa.
  describe "outros erros da gravação" do
    @tag :capture_log
    test "erro da gravação que não vem dos achados é passageiro (internal_error)" do
      page = page_fixture()
      # `http_status` fora da faixa do changeset da página: a recusa é da página, não de um
      # achado (o cliente real já recusaria; aqui o mock entrega direto à gravação).
      expect_scan(page, {:ok, Map.put(scanner_response("limpa"), "http_status", 700)})

      assert {:error, :internal_error} = perform(page, attempt: 1)

      assert %Page{status: :scanning, error: nil} = reload(page)
      assert %Audit{status: :running, pages_failed: 0} = audit_of(page)
    end

    @tag :capture_log
    test "na última tentativa fecha a página com internal_error" do
      page = page_fixture()
      expect_scan(page, {:ok, Map.put(scanner_response("limpa"), "http_status", 700)})

      assert {:cancel, :internal_error} = perform(page, attempt: 2)

      assert %Page{status: :failed, error: "internal_error"} = reload(page)
    end

    @tag :capture_log
    test "tarefa scan apagada durante a varredura cancela sem marcar falha" do
      page = page_fixture()

      expect(ClientMock, :scan, fn _url ->
        Repo.delete_all(from t in PageTask, where: t.page_id == ^page.id)
        {:ok, scanner_response("limpa")}
      end)

      assert {:cancel, :task_not_found} = perform(page, attempt: 1)
      assert %Page{error: nil} = reload(page)
    end
  end

  describe "nodes_total" do
    test "regra com 30 nós (20 enviados) gera 20 achados e o total 30 fica no raw" do
      page = page_fixture()

      response =
        update_in(scanner_response("img-sem-alt"), ["axe", "violations"], fn [rule] ->
          [node] = rule["nodes"]
          [%{rule | "nodes" => List.duplicate(node, 20), "nodes_total" => 30}]
        end)

      expect_scan(page, {:ok, response})
      assert :ok = perform(page)

      found = findings(page)
      assert length(found) == 20
      assert Enum.all?(found, &(&1.raw["nodes_total"] == 30))
    end
  end

  describe "target cortado pelo scanner" do
    test "nó com target_truncated grava selector nulo e mantém o trecho de HTML" do
      page = page_fixture()
      expect_scan(page, {:ok, with_node(&Map.put(&1, "target_truncated", true))})

      assert :ok = perform(page)

      assert [%Finding{selector: nil, html_snippet: "<img" <> _}] = findings(page)
    end
  end

  describe "exceções" do
    @tag :capture_log
    test "na primeira tentativa relança sem marcar falha" do
      page = page_fixture()
      expect(ClientMock, :scan, fn _url -> raise "scanner quebrou" end)

      assert_raise RuntimeError, "scanner quebrou", fn -> perform(page, attempt: 1) end

      assert %Page{status: :scanning} = reload(page)
      assert %Audit{status: :running} = audit_of(page)
    end

    @tag :capture_log
    test "na última tentativa fecha a tarefa e cancela o job, sem nova tentativa" do
      page = page_fixture()
      expect(ClientMock, :scan, fn _url -> raise "scanner quebrou" end)

      assert {:cancel, :internal_error} = perform(page, attempt: 2)

      assert %Page{status: :failed, error: "internal_error"} = reload(page)
      assert %Audit{status: :failed, error: "internal_error", pages_failed: 1} = audit_of(page)
    end

    @tag :capture_log
    test "exceção ao gravar desfaz a gravação e marca falha na última tentativa" do
      page = page_fixture()
      # Seletor num formato que o axe não produz: a conversão levanta exceção na transação.
      expect_scan(page, {:ok, with_node(&Map.put(&1, "target", [%{"x" => 1}]))})

      assert {:cancel, :internal_error} = perform(page, attempt: 2)

      assert %Page{status: :failed, error: "internal_error", axe_version: nil} = reload(page)
      assert findings(page) == []
    end
  end

  describe "exit e prazo" do
    @tag :capture_log
    test "exit na primeira tentativa volta ao Oban sem marcar falha" do
      page = page_fixture()
      expect(ClientMock, :scan, fn _url -> exit(:scanner_caiu) end)

      # O Oban registra o `exit` como `Oban.CrashError` e tenta de novo.
      assert_raise Oban.CrashError, ~r/scanner_caiu/, fn -> perform(page, attempt: 1) end
      assert %PageTask{status: :running} = scan_task(page)
    end

    @tag :capture_log
    test "exit na última tentativa fecha a tarefa internal_error e cancela o job" do
      page = page_fixture()

      expect(ClientMock, :scan, fn _url ->
        GenServer.call(:processo_que_nao_existe, :scan)
      end)

      assert {:cancel, :internal_error} = perform(page, attempt: 2)

      assert %PageTask{status: :failed, error: "internal_error"} = scan_task(page)
      assert %Page{status: :failed, error: "internal_error"} = reload(page)
      assert %Audit{status: :failed} = audit_of(page)
    end
  end

  describe "RF-RA002: URL revalidada antes do scanner" do
    # Sem `expect` no ClientMock: se o scanner fosse chamado, o Mox falharia.
    for {url, code} <- [
          {"http://localhost:4000/", :blocked_address},
          {"http://169.254.169.254/latest/meta-data/", :blocked_address},
          {"http://postgres/", :blocked_address},
          {"http://[::1]/", :blocked_address},
          {"https://exemplo.com:8443/", :blocked_address},
          {"ftp://exemplo.com/", :unsupported_scheme},
          {"https://user:senha@exemplo.com/", :invalid_url}
        ] do
      @tag :capture_log
      test "#{url} marca a página #{code} sem chamar o scanner" do
        code = unquote(code)
        page = page_fixture(%{url: unquote(url)})

        assert {:cancel, ^code} = perform(page, attempt: 1)

        error = Atom.to_string(code)
        assert %Page{status: :failed, error: ^error} = reload(page)
        assert %Audit{status: :failed, error: ^error, pages_failed: 1} = audit_of(page)
        assert findings(page) == []
      end
    end

    @tag :capture_log
    test "domínio que passou a resolver para IP privado é bloqueado sem chamar o scanner" do
      page = page_fixture(%{url: "https://rebind.exemplo.com/"})
      expect(ResolverMock, :resolve, fn "rebind.exemplo.com" -> {:ok, [{10, 0, 0, 5}]} end)

      assert {:cancel, :blocked_address} = perform(page, attempt: 1)
      assert %Page{status: :failed, error: "blocked_address"} = reload(page)
    end

    @tag :capture_log
    test "nome sem registro no DNS é definitivo" do
      page = page_fixture(%{url: "https://nao-existe.exemplo.com/"})
      expect(ResolverMock, :resolve, fn _host -> {:error, :nxdomain} end)

      assert {:cancel, :unresolvable} = perform(page, attempt: 1)
      assert %Page{status: :failed, error: "unresolvable"} = reload(page)
    end

    @tag :capture_log
    test "falha do resolvedor tenta de novo e só marca falha na última tentativa" do
      page = page_fixture(%{url: "https://instavel.exemplo.com/"})
      expect(ResolverMock, :resolve, 2, fn _host -> {:error, :timeout} end)

      assert {:error, :dns_error} = perform(page, attempt: 1)
      assert %Page{status: :scanning, error: nil} = reload(page)

      assert {:cancel, :dns_error} = perform(page, attempt: 2)
      assert %Page{status: :failed, error: "dns_error"} = reload(page)
    end

    @tag :capture_log
    test "falha passageira do DNS seguida de sucesso varre a página" do
      page = page_fixture(%{url: "https://instavel.exemplo.com/limpa.html"})
      expect(ResolverMock, :resolve, fn _host -> {:error, :servfail} end)
      assert {:error, :dns_error} = perform(page, attempt: 1)

      expect(ResolverMock, :resolve, fn _host -> {:ok, [{93, 184, 215, 14}]} end)
      expect_scan(page, {:ok, scanner_response("limpa")})
      assert :ok = perform(page, attempt: 2)
      assert %Page{status: :done} = reload(page)
    end

    test "o scanner recebe a URL normalizada" do
      page = page_fixture(%{url: "https://Exemplo.COM/limpa.html#topo"})

      expect(ClientMock, :scan, fn url ->
        assert url == "https://exemplo.com/limpa.html"
        {:ok, scanner_response("limpa")}
      end)

      assert :ok = perform(page)
    end
  end

  describe "tarefa scan" do
    test "fica running com o attempt do Oban enquanto o scanner trabalha" do
      page = page_fixture()

      expect(ClientMock, :scan, fn _url ->
        assert %PageTask{status: :running, attempt: 1, started_at: %DateTime{}} =
                 scan_task(page)

        {:ok, scanner_response("limpa")}
      end)

      assert :ok = perform(page)
    end

    test "fecha done com finished_at quando a varredura dá certo" do
      page = page_fixture()
      expect_scan(page, {:ok, scanner_response("limpa")})

      assert :ok = perform(page)

      assert %PageTask{status: :done, error: nil, attempt: 1, finished_at: %DateTime{}} =
               scan_task(page)
    end

    @tag :capture_log
    test "fica running entre as tentativas e fecha failed na última" do
      page = page_fixture()
      expect_scan(page, {:error, %{code: :timeout, detail: "detalhe"}})
      assert {:error, :timeout} = perform(page, attempt: 1)
      assert %PageTask{status: :running, attempt: 1, finished_at: nil} = scan_task(page)

      expect_scan(page, {:error, %{code: :timeout, detail: "detalhe"}})
      assert {:cancel, :timeout} = perform(page, attempt: 2)

      assert %PageTask{status: :failed, error: "timeout", attempt: 2, finished_at: %DateTime{}} =
               scan_task(page)
    end

    @tag :capture_log
    test "job reenfileirado pela reconciliação continua contando as tentativas da tarefa" do
      # A tarefa já começou uma vez; o job novo começa do attempt 1 no Oban.
      page = page_fixture(%{task: %{status: :pending, attempt: 1}})
      expect_scan(page, {:error, %{code: :timeout, detail: "detalhe"}})

      assert {:cancel, :timeout} = perform(page, attempt: 1)

      assert %PageTask{status: :failed, attempt: 2, error: "timeout"} = scan_task(page)
      assert %Audit{status: :failed, pages_failed: 1} = audit_of(page)
    end

    test "página sem tarefa scan cancela o job sem chamar o scanner" do
      page = page_fixture()
      Repo.delete_all(from t in PageTask, where: t.page_id == ^page.id)

      assert {:cancel, :task_not_found} = perform(page)
      assert %Page{status: :queued} = reload(page)
    end

    test "uma página entre várias não encerra a auditoria enquanto outra tem tarefa aberta" do
      audit = audit_fixture(%{page_limit: 2})
      page = page_fixture(%{audit: audit, url: "https://exemplo.com/a"})
      _other = page_fixture(%{audit: audit, url: "https://exemplo.com/b"})
      expect_scan(page, {:ok, scanner_response("img-sem-alt")})

      assert :ok = perform(page)

      assert %Audit{status: :running, pages_found: 2, pages_scanned: 1, finished_at: nil} =
               reload(audit)
    end

    @tag :capture_log
    test "falha definitiva do scan fecha as outras tarefas abertas da página" do
      page = page_fixture()
      task_fixture(page, %{kind: :alt_text})
      expect_scan(page, {:error, %{code: :http_error, detail: "HTTP 404"}})

      assert {:cancel, :http_error} = perform(page)

      assert %PageTask{status: :failed, error: "scan_failed"} =
               Repo.get_by!(PageTask, page_id: page.id, kind: :alt_text)

      assert %Page{status: :failed, error: "http_error"} = reload(page)
      assert %Audit{status: :failed, error: "http_error"} = audit_of(page)
    end
  end

  test "página inexistente cancela o job sem chamar o scanner" do
    assert {:cancel, :page_not_found} =
             perform_job(ScanPageJob, %{"page_id" => Ecto.UUID.generate()})

    assert {:cancel, :page_not_found} = perform_job(ScanPageJob, %{"page_id" => "nao-e-uuid"})
  end
end
