defmodule Rampa.Audits.ReconcileTasksJobTest do
  use Rampa.DataCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Page, PageTask, ReconcileTasksJob, ScanPageJob}

  @moduletag :capture_log

  defp ago(minutes), do: DateTime.add(DateTime.utc_now(:second), -minutes * 60)
  defp later(minutes), do: DateTime.add(DateTime.utc_now(:second), minutes * 60)

  defp task(page, kind \\ :scan), do: Repo.get_by!(PageTask, page_id: page.id, kind: kind)
  defp reload(%Page{} = page), do: Repo.get!(Page, page.id)
  defp audit_of(page), do: Repo.get!(Audit, page.audit_id)

  # Tudo o que a reconciliação pode mudar, para comparar duas execuções seguidas.
  defp state do
    {
      Repo.all(from a in Audit, order_by: a.id),
      Repo.all(from p in Page, order_by: p.id),
      Repo.all(from t in PageTask, order_by: t.id),
      Repo.all(from j in Oban.Job, order_by: j.id)
    }
  end

  defp assert_idempotent(opts) do
    first = state()
    assert %{requeued: 0, failed: 0, error: 0} = Audits.reconcile_stale_tasks(opts)
    assert state() == first
  end

  defp scan_jobs, do: all_enqueued(worker: ScanPageJob)

  describe "tarefa running presa" do
    test "com tentativa sobrando volta a pending e o job é reenfileirado" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 1, started_at: ago(20)}})

      assert %{requeued: 1, failed: 0} = Audits.reconcile_stale_tasks()

      assert %PageTask{status: :pending, attempt: 1} = task(page)
      assert %Page{status: :queued} = reload(page)
      assert %Audit{status: :queued, finished_at: nil} = audit_of(page)
      assert [%Oban.Job{args: %{"page_id" => page_id}}] = scan_jobs()
      assert page_id == page.id

      assert_idempotent([])
    end

    test "sem tentativa sobrando fecha failed com stale e roda a regra de conclusão" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 2, started_at: ago(20)}})

      assert %{failed: 1, requeued: 0} = Audits.reconcile_stale_tasks()

      assert %PageTask{status: :failed, error: "stale", finished_at: %DateTime{}} = task(page)
      assert %Page{status: :failed, error: "stale"} = reload(page)

      assert %Audit{status: :failed, error: "stale", pages_failed: 1} = audit = audit_of(page)
      assert %DateTime{} = audit.finished_at
      assert scan_jobs() == []

      assert_idempotent([])
    end

    test "o job antigo que ainda existe não é duplicado" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 1, started_at: ago(20)}})
      {:ok, existing} = Oban.insert(ScanPageJob.new(%{"page_id" => page.id}))

      assert %{requeued: 1} = Audits.reconcile_stale_tasks()

      assert %PageTask{status: :pending} = task(page)
      assert [%Oban.Job{id: id}] = scan_jobs()
      assert id == existing.id
    end

    test "dentro do prazo não é tocada" do
      page_fixture(%{status: :scanning, task: %{attempt: 1, started_at: ago(5)}})

      assert_idempotent([])
    end

    test "o prazo é configurável" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 2, started_at: ago(5)}})

      assert_idempotent(stale_running_after: 600)
      assert %{failed: 1} = Audits.reconcile_stale_tasks(stale_running_after: 60)
      assert %PageTask{status: :failed} = task(page)
    end
  end

  describe "tarefa pending presa" do
    test "sem job correspondente é reenfileirada uma vez só" do
      page = page_fixture()

      assert %{requeued: 1} = Audits.reconcile_stale_tasks(now: later(20))

      assert [%Oban.Job{}] = scan_jobs()
      assert %PageTask{status: :pending, attempt: 0} = task(page)

      assert_idempotent(now: later(20))
      assert [%Oban.Job{}] = scan_jobs()
    end

    test "com o job ainda na fila não muda nada" do
      page = page_fixture()
      {:ok, _job} = Oban.insert(ScanPageJob.new(%{"page_id" => page.id}))

      assert %{unchanged: 1} = Audits.reconcile_stale_tasks(now: later(20))
      assert [%Oban.Job{}] = scan_jobs()
    end

    test "dentro do prazo não é tocada" do
      page_fixture()

      assert_idempotent([])
      assert scan_jobs() == []
    end

    test "tipo sem job (análise antes do M4) fecha failed e a página termina done" do
      page = page_fixture(%{status: :analyzing})
      task_fixture(page, %{kind: :alt_text})

      assert %{failed: 1} = Audits.reconcile_stale_tasks(now: later(20))

      assert %PageTask{status: :failed, error: "stale"} = task(page, :alt_text)
      assert %Page{status: :done, error: nil} = reload(page)
      assert %Audit{status: :completed, pages_scanned: 1} = audit_of(page)

      assert_idempotent(now: later(20))
    end
  end

  for status <- [:completed, :failed, :cancelled] do
    test "auditoria #{status} é ignorada" do
      audit = audit_fixture(%{status: unquote(status)})
      page_fixture(%{audit: audit, status: :scanning, task: %{attempt: 2, started_at: ago(60)}})

      assert_idempotent(now: later(60))
    end
  end

  test "o lote limita quantas tarefas são tratadas por rodada" do
    audit = audit_fixture(%{page_limit: 3})

    for path <- ~w(a b c) do
      page_fixture(%{audit: audit, url: "https://exemplo.com/#{path}"})
    end

    assert %{requeued: 2} = Audits.reconcile_stale_tasks(now: later(20), batch_size: 2)
    assert %{requeued: 1, unchanged: 2} = Audits.reconcile_stale_tasks(now: later(20))
    assert length(scan_jobs()) == 3
  end

  describe "ReconcileTasksJob" do
    test "fila maintenance e uma execução por vez" do
      assert %{queue: "maintenance"} = ReconcileTasksJob.new(%{}).changes

      assert {:ok, first} = Oban.insert(ReconcileTasksJob.new(%{}))
      assert {:ok, second} = Oban.insert(ReconcileTasksJob.new(%{}))
      assert second.conflict?
      assert second.id == first.id
    end

    test "reconcilia e duas execuções seguidas dão o mesmo estado" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 2, started_at: ago(20)}})

      assert :ok = perform_job(ReconcileTasksJob, %{})
      assert %PageTask{status: :failed, error: "stale"} = task(page)

      snapshot = state()
      assert :ok = perform_job(ReconcileTasksJob, %{})
      assert state() == snapshot
    end
  end

  describe "configuração (ciclo de vida)" do
    setup do
      %{
        oban: Application.fetch_env!(:rampa, Oban),
        reconciliation: Application.fetch_env!(:rampa, :task_reconciliation)
      }
    end

    test "o Cron agenda o ReconcileTasksJob", %{oban: oban} do
      assert {_expr, ReconcileTasksJob} =
               Enum.find(oban[:cron][:crontab], &match?({_, ReconcileTasksJob}, &1))
    end

    test "o Lifeline nunca resgata um ScanPageJob vivo e age antes do reconciliador",
         %{oban: oban, reconciliation: reconciliation} do
      rescue_after = Oban.Period.to_milliseconds(oban[:lifeline][:rescue_after])
      job_timeout = ScanPageJob.timeout(%Oban.Job{})
      lifeline_interval = :timer.minutes(1)

      # Uma tentativa: DNS (5 s) + cliente do scanner (100 s), com folga.
      assert job_timeout > :timer.seconds(105)
      assert rescue_after > job_timeout

      assert :timer.seconds(reconciliation[:stale_running_after]) >
               rescue_after + lifeline_interval + job_timeout
    end
  end
end
