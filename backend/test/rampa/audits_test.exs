defmodule Rampa.AuditsTest do
  use Rampa.DataCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Mox
  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Finding, Page, PageTask, ScanPageJob}
  alias Rampa.Security.ResolverMock

  setup :verify_on_exit!

  setup do
    stub(ResolverMock, :resolve, fn _host -> {:ok, [{93, 184, 215, 14}]} end)
    :ok
  end

  defp reload(%Audit{} = audit), do: Repo.get!(Audit, audit.id)
  defp reload(%Page{} = page), do: Repo.get!(Page, page.id)
  defp audit_of(page), do: Repo.get!(Audit, page.audit_id)
  defp task(page, kind), do: Repo.get_by!(PageTask, page_id: page.id, kind: kind)
  defp tasks(page), do: Repo.all(from t in PageTask, where: t.page_id == ^page.id)
  defp pages(audit), do: Repo.all(from p in Page, where: p.audit_id == ^audit.id)

  defp scan_ok(page) do
    assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
    assert {:ok, _page} = Audits.record_scan_result(page, scanner_response("img-sem-alt"))
  end

  describe "add_page/2" do
    test "cria a página queued com a tarefa scan pending e o job, na mesma transação" do
      audit = audit_fixture(%{page_limit: 2})

      assert {:ok, %Page{status: :queued} = page} =
               Audits.add_page(audit.id, "https://Exemplo.com/contato#topo")

      assert page.url == "https://exemplo.com/contato"
      assert [%PageTask{kind: :scan, status: :pending, attempt: 0}] = tasks(page)
      assert_enqueued(worker: ScanPageJob, args: %{"page_id" => page.id}, queue: :scan)
      assert %Audit{status: :queued, pages_found: 1} = reload(audit)
    end

    test "a URL passa pelo URLGuard antes de qualquer gravação" do
      audit = audit_fixture()

      assert {:error, :blocked_address} = Audits.add_page(audit.id, "http://169.254.169.254/")
      assert {:error, :unsupported_scheme} = Audits.add_page(audit.id, "ftp://exemplo.com/")

      expect(ResolverMock, :resolve, fn _host -> {:ok, [{10, 0, 0, 5}]} end)

      assert {:error, :blocked_address} =
               Audits.add_page(audit.id, "https://interno.exemplo.com/")

      assert pages(audit) == []
      refute_enqueued(worker: ScanPageJob)
    end

    for status <- [:completed, :failed, :cancelled] do
      test "auditoria #{status} não aceita página nova" do
        audit = audit_fixture(%{status: unquote(status), page_limit: 5})

        assert {:error, :already_finished} = Audits.add_page(audit.id, "https://exemplo.com/b")

        assert pages(audit) == []
        assert reload(audit) == audit
        refute_enqueued(worker: ScanPageJob)
      end
    end

    test "auditoria em andamento aceita página nova (M5)" do
      audit = audit_fixture(%{status: :running, page_limit: 3})
      page_fixture(%{audit: audit, status: :done})

      assert {:ok, page} = Audits.add_page(audit.id, "https://exemplo.com/nova")

      assert %Audit{status: :running, pages_found: 2, pages_scanned: 1} = reload(audit)
      assert %PageTask{status: :pending} = task(page, :scan)
    end

    test "página nova numa auditoria com tudo pronto, mas ainda aberta, impede o fim" do
      audit = audit_fixture(%{page_limit: 2})
      page = page_fixture(%{audit: audit})
      assert {:ok, _new} = Audits.add_page(audit.id, "https://exemplo.com/descoberta")

      scan_ok(page)

      assert %Audit{status: :running, pages_found: 2, pages_scanned: 1} = reload(audit)
    end

    test "não repete URL e respeita o page_limit" do
      audit = audit_fixture(%{page_limit: 2})

      assert {:ok, _page} = Audits.add_page(audit.id, "https://exemplo.com/a")
      assert {:error, :duplicate_url} = Audits.add_page(audit.id, "https://EXEMPLO.com/a#x")
      assert {:ok, _page} = Audits.add_page(audit.id, "https://exemplo.com/b")
      assert {:error, :page_limit_reached} = Audits.add_page(audit.id, "https://exemplo.com/c")

      assert length(pages(audit)) == 2
      assert %Audit{pages_found: 2} = reload(audit)
    end

    test "auditoria inexistente" do
      assert {:error, :audit_not_found} =
               Audits.add_page(Ecto.UUID.generate(), "https://exemplo.com/")

      assert {:error, :audit_not_found} = Audits.add_page("nao-e-uuid", "https://exemplo.com/")
    end
  end

  describe "add_task/2" do
    test "acrescenta tarefa pending a página aberta (M4)" do
      page = page_fixture(%{status: :scanning})

      assert {:ok, %PageTask{kind: :alt_text, status: :pending, attempt: 0} = task} =
               Audits.add_task(page.id, :alt_text)

      assert task.audit_id == page.audit_id
      assert %Page{status: :scanning} = reload(page)
    end

    test "página em analyzing aceita mais uma análise" do
      page = page_fixture(%{status: :analyzing})
      task_fixture(page, %{kind: :alt_text})

      assert {:ok, _task} = Audits.add_task(page.id, :links)
      assert %Page{status: :analyzing} = reload(page)
    end

    for status <- [:done, :failed] do
      test "página #{status} não ganha tarefa" do
        page = page_fixture(%{status: unquote(status)})

        assert {:error, :already_finished} = Audits.add_task(page.id, :alt_text)
        assert [%PageTask{kind: :scan}] = tasks(page)
      end
    end

    for status <- [:completed, :failed, :cancelled] do
      test "auditoria #{status} não aceita tarefa nova" do
        audit = audit_fixture(%{status: unquote(status)})
        page = page_fixture(%{audit: audit})

        assert {:error, :already_finished} = Audits.add_task(page.id, :alt_text)
        assert [%PageTask{kind: :scan}] = tasks(page)
      end
    end

    test "uma tarefa de cada tipo por página e só tipos conhecidos" do
      page = page_fixture()

      assert {:error, :duplicate_task} = Audits.add_task(page.id, :scan)
      assert {:ok, _task} = Audits.add_task(page.id, :focus)
      assert {:error, :duplicate_task} = Audits.add_task(page.id, :focus)
      assert {:error, :invalid_kind} = Audits.add_task(page.id, :contrast)
      assert {:error, :invalid_kind} = Audits.add_task(page.id, "focus")
      assert {:error, :page_not_found} = Audits.add_task(Ecto.UUID.generate(), :links)
    end
  end

  describe "start_task/3" do
    test "marca running com attempt e started_at, e a auditoria running" do
      page = page_fixture()

      assert {:ok, %PageTask{status: :running, attempt: 1, page: %Page{status: :scanning}}} =
               Audits.start_task(page.id, :scan, 1)

      assert %Audit{status: :running, started_at: %DateTime{}} = audit_of(page)
    end

    test "o attempt nunca volta atrás" do
      page = page_fixture(%{task: %{status: :pending, attempt: 1}})

      assert {:ok, %PageTask{attempt: 2}} = Audits.start_task(page.id, :scan, 1)
      assert {:ok, %PageTask{attempt: 3}} = Audits.start_task(page.id, :scan, 3)
    end

    test "recusa tarefa inexistente ou terminada e auditoria encerrada" do
      page = page_fixture()
      assert {:error, :task_not_found} = Audits.start_task(page.id, :links, 1)
      assert {:error, :page_not_found} = Audits.start_task(Ecto.UUID.generate(), :scan, 1)

      done = page_fixture(%{status: :done, url: "https://exemplo.com/feita"})
      assert {:error, :already_finished} = Audits.start_task(done.id, :scan, 1)

      cancelled = page_fixture(%{audit: audit_fixture(%{status: :cancelled})})
      assert {:error, :already_finished} = Audits.start_task(cancelled.id, :scan, 1)
      assert %PageTask{status: :pending} = task(cancelled, :scan)
    end
  end

  describe "ciclo com análises (preparo do M4)" do
    setup do
      page = page_fixture()
      {:ok, _task} = Audits.add_task(page.id, :alt_text)
      %{page: page}
    end

    test "o scan concluído com análise pendente deixa a página analyzing e a auditoria aberta",
         %{page: page} do
      scan_ok(page)

      assert %Page{status: :analyzing, error: nil, scanned_at: %DateTime{}} = reload(page)
      assert %PageTask{status: :done} = task(page, :scan)
      assert %PageTask{status: :pending} = task(page, :alt_text)

      assert %Audit{status: :running, pages_scanned: 1, pages_failed: 0, finished_at: nil} =
               audit_of(page)
    end

    test "a análise rodando mantém analyzing", %{page: page} do
      scan_ok(page)

      assert {:ok, %PageTask{status: :running, page: %Page{status: :analyzing}}} =
               Audits.start_task(page.id, :alt_text, 1)
    end

    test "a falha da análise não falha a página e encerra a auditoria completed",
         %{page: page} do
      scan_ok(page)
      assert {:ok, _task} = Audits.start_task(page.id, :alt_text, 1)

      assert {:ok, %Page{status: :done, error: nil}} =
               Audits.fail_task(page.id, :alt_text, :invalid_response)

      assert %PageTask{status: :failed, error: "invalid_response", finished_at: %DateTime{}} =
               task(page, :alt_text)

      assert %Audit{status: :completed, pages_scanned: 1, pages_failed: 0} =
               audit = audit_of(page)

      assert %DateTime{} = audit.finished_at
    end

    test "a falha do scan fecha a análise junto e a página falha", %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert {:ok, %Page{status: :failed}} = Audits.fail_task(page.id, :scan, :timeout)

      assert %PageTask{status: :failed, error: "scan_failed"} = task(page, :alt_text)

      assert %Audit{status: :failed, error: "timeout", pages_failed: 1, pages_scanned: 0} =
               audit_of(page)
    end
  end

  describe "regra de conclusão" do
    test "auditoria com uma página done e outra failed termina completed" do
      audit = audit_fixture(%{page_limit: 2})
      first = page_fixture(%{audit: audit, url: "https://exemplo.com/a"})
      second = page_fixture(%{audit: audit, url: "https://exemplo.com/b"})

      scan_ok(first)
      assert %Audit{status: :running} = reload(audit)

      assert {:ok, _page} = Audits.fail_task(second.id, :scan, :http_error)

      assert %Audit{
               status: :completed,
               error: nil,
               pages_found: 2,
               pages_scanned: 1,
               pages_failed: 1
             } = reload(audit)
    end

    test "todas as páginas falharam: failed, com o erro da última" do
      audit = audit_fixture(%{page_limit: 2})
      first = page_fixture(%{audit: audit, url: "https://exemplo.com/a"})
      second = page_fixture(%{audit: audit, url: "https://exemplo.com/b"})

      assert {:ok, _page} = Audits.fail_task(first.id, :scan, :timeout)
      assert %Audit{status: :queued, pages_failed: 1} = reload(audit)

      assert {:ok, _page} = Audits.fail_task(second.id, :scan, :blocked_address)

      assert %Audit{status: :failed, error: "blocked_address", pages_failed: 2} =
               audit = reload(audit)

      assert %DateTime{} = audit.finished_at
    end

    test "fechar a mesma tarefa duas vezes não muda nada" do
      page = page_fixture()
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert {:ok, _page} = Audits.fail_task(page.id, :scan, :timeout)
      snapshot = {audit_of(page), reload(page), tasks(page)}

      assert {:error, :already_finished} = Audits.fail_task(page.id, :scan, :timeout)
      assert {:error, :already_finished} = Audits.fail_task(page.id, :scan, :http_error)

      assert {:error, :already_finished} =
               Audits.record_scan_result(page, scanner_response("limpa"))

      assert {audit_of(page), reload(page), tasks(page)} == snapshot
    end

    test "gravar o mesmo resultado duas vezes não duplica achado nem contador" do
      page = page_fixture()
      scan_ok(page)
      snapshot = {audit_of(page), reload(page), tasks(page)}

      assert {:error, :already_finished} =
               Audits.record_scan_result(page, scanner_response("img-sem-alt"))

      assert {audit_of(page), reload(page), tasks(page)} == snapshot
      assert Repo.aggregate(from(f in Finding, where: f.page_id == ^page.id), :count) == 1
    end

    test "os contadores são recalculados a partir das páginas, não incrementados" do
      audit = audit_fixture(%{pages_scanned: 7, pages_failed: 3, pages_found: 9})
      page = page_fixture(%{audit: audit})

      scan_ok(page)

      assert %Audit{pages_found: 1, pages_scanned: 1, pages_failed: 0} = reload(audit)
    end
  end
end
