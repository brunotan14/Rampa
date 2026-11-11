defmodule Rampa.Audits.ScanPageJobDeadlineTest do
  # Altera `:scan_deadline_ms`, configuração global: não roda junto com os outros testes.
  use Rampa.DataCase, async: false
  use Oban.Testing, repo: Rampa.Repo

  import Mox
  import Rampa.AuditsFixtures

  alias Rampa.Audits.{Audit, Page, PageTask, ScanPageJob}
  alias Rampa.Scanner.ClientMock
  alias Rampa.Security.ResolverMock

  @moduletag :capture_log

  setup :verify_on_exit!

  setup do
    stub(ResolverMock, :resolve, fn _host -> {:ok, [{93, 184, 215, 14}]} end)

    previous = Application.fetch_env!(:rampa, :scan_deadline_ms)
    Application.put_env(:rampa, :scan_deadline_ms, 50)
    on_exit(fn -> Application.put_env(:rampa, :scan_deadline_ms, previous) end)

    page = page_fixture()

    # Scanner que não responde dentro do prazo.
    expect(ClientMock, :scan, fn _url ->
      Process.sleep(:timer.seconds(5))
      {:ok, scanner_response("limpa")}
    end)

    %{page: page}
  end

  defp perform(page, attempt),
    do: perform_job(ScanPageJob, %{"page_id" => page.id}, attempt: attempt)

  defp scan_task(page), do: Repo.get_by!(PageTask, page_id: page.id, kind: :scan)

  test "prazo estourado na primeira tentativa: nova tentativa, tarefa ainda running",
       %{page: page} do
    assert {:error, :timeout} = perform(page, 1)

    assert %PageTask{status: :running} = scan_task(page)
    assert %Page{status: :scanning} = Repo.get!(Page, page.id)
  end

  test "prazo estourado na última tentativa: tarefa failed com timeout e job cancelado",
       %{page: page} do
    assert {:cancel, :timeout} = perform(page, 2)

    assert %PageTask{status: :failed, error: "timeout"} = scan_task(page)
    assert %Page{status: :failed, error: "timeout"} = Repo.get!(Page, page.id)
    assert %Audit{status: :failed, error: "timeout"} = Repo.get!(Audit, page.audit_id)
  end
end
