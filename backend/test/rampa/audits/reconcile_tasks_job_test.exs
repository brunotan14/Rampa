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

  # Job da tarefa num estado do Oban (vivo: available, retryable...; morto: discarded...).
  defp scan_job(page, state) do
    {:ok, job} = Oban.insert(ScanPageJob.new(%{"page_id" => page.id}))
    Repo.update_all(from(j in Oban.Job, where: j.id == ^job.id), set: [state: state])
    job
  end

  defp kill_jobs, do: Repo.update_all(Oban.Job, set: [state: "discarded"])

  describe "tarefa running presa" do
    test "com tentativa sobrando volta a pending e o job é reenfileirado" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 1, started_at: ago(20)}})

      assert %{requeued: 1, failed: 0} = Audits.reconcile_stale_tasks()

      assert %PageTask{status: :pending, attempt: 1, requeues: 1} = task(page)
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

    for state <- ~w(available scheduled executing retryable) do
      test "com job #{state} no Oban não é tocada: a página não volta a queued" do
        page = page_fixture(%{status: :scanning, task: %{attempt: 1, started_at: ago(60)}})
        scan_job(page, unquote(state))

        assert_idempotent([])
        assert %PageTask{status: :running, requeues: 0} = task(page)
        assert %Page{status: :scanning} = reload(page)
      end
    end

    test "com o job já morto, é reconciliada logo depois do timeout do job" do
      # timeout do ScanPageJob (3 min) + folga (1 min): 5 min já passou, sem esperar 10.
      page = page_fixture(%{status: :scanning, task: %{attempt: 2, started_at: ago(5)}})
      scan_job(page, "discarded")

      assert %{failed: 1} = Audits.reconcile_stale_tasks()
      assert %PageTask{status: :failed, error: "stale"} = task(page)
    end

    test "dentro do timeout do job não é tocada, mesmo sem job vivo" do
      page_fixture(%{status: :scanning, task: %{attempt: 2, started_at: ago(3)}})

      assert_idempotent([])
    end

    test "a folga é configurável" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 2, started_at: ago(5)}})

      assert_idempotent(running_grace: 600)
      assert %{failed: 1} = Audits.reconcile_stale_tasks(running_grace: 60)
      assert %PageTask{status: :failed} = task(page)
    end
  end

  describe "tarefa pending presa" do
    test "sem job vivo é reenfileirada uma vez só" do
      page = page_fixture()

      assert %{requeued: 1} = Audits.reconcile_stale_tasks(now: later(20))

      assert [%Oban.Job{}] = scan_jobs()
      assert %PageTask{status: :pending, attempt: 0, requeues: 1} = task(page)

      assert_idempotent(now: later(20))
      assert [%Oban.Job{}] = scan_jobs()
    end

    test "com o job ainda na fila não muda nada" do
      page = page_fixture()
      scan_job(page, "available")

      assert_idempotent(now: later(20))
      assert [%Oban.Job{}] = scan_jobs()
    end

    test "dentro do prazo não é tocada" do
      page_fixture()

      assert_idempotent([])
      assert scan_jobs() == []
    end

    test "cujo job morre sempre antes de começar fecha stale depois do limite de reenfileiramentos" do
      page = page_fixture()

      for requeues <- 1..3 do
        assert %{requeued: 1} = Audits.reconcile_stale_tasks(now: later(20))
        assert %PageTask{status: :pending, requeues: ^requeues} = task(page)
        kill_jobs()
      end

      assert %{failed: 1, requeued: 0} = Audits.reconcile_stale_tasks(now: later(20))

      assert %PageTask{status: :failed, error: "stale", requeues: 3} = task(page)
      assert %Audit{status: :failed, error: "stale"} = audit_of(page)
      assert_idempotent(now: later(20))
    end

    test "o limite de reenfileiramentos vale também para a tarefa running" do
      page =
        page_fixture(%{
          status: :scanning,
          task: %{attempt: 1, requeues: 3, started_at: ago(20)}
        })

      assert %{failed: 1} = Audits.reconcile_stale_tasks()
      assert %PageTask{status: :failed, error: "stale"} = task(page)
    end

    test "tipo sem job (análise antes do M4) fecha failed e a página termina done" do
      page = page_fixture(%{status: :analyzing, task: %{finished_at: ago(30)}})
      task_fixture(page, %{kind: :alt_text})

      assert %{failed: 1} = Audits.reconcile_stale_tasks(now: later(20))

      assert %PageTask{status: :failed, error: "stale"} = task(page, :alt_text)
      assert %Page{status: :done, error: nil} = reload(page)
      assert %Audit{status: :completed, pages_scanned: 1} = audit_of(page)

      assert_idempotent(now: later(20))
    end

    test "análise não é reconciliada enquanto o scan da página está aberto" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 1, started_at: ago(1)}})
      scan_job(page, "executing")
      task_fixture(page, %{kind: :alt_text, updated_at: ago(60), inserted_at: ago(60)})

      assert_idempotent(now: later(60))
      assert %PageTask{status: :pending} = task(page, :alt_text)
    end

    test "o prazo da análise só começa quando o scan termina" do
      page = page_fixture(%{status: :analyzing, task: %{finished_at: ago(5)}})
      task_fixture(page, %{kind: :alt_text, updated_at: ago(60), inserted_at: ago(60)})

      assert_idempotent([])
      assert %PageTask{status: :pending} = task(page, :alt_text)

      assert %{failed: 1} = Audits.reconcile_stale_tasks(now: later(6))
    end
  end

  for status <- [:completed, :failed, :cancelled] do
    test "auditoria #{status} é ignorada" do
      audit = audit_fixture(%{status: unquote(status)})
      page_fixture(%{audit: audit, status: :scanning, task: %{attempt: 2, started_at: ago(60)}})

      assert_idempotent(now: later(60))
    end
  end

  describe "lote" do
    test "limita quantas tarefas são tratadas por rodada" do
      audit = audit_fixture(%{page_limit: 3})

      for path <- ~w(a b c) do
        page_fixture(%{audit: audit, url: "https://exemplo.com/#{path}"})
      end

      assert %{requeued: 2} = Audits.reconcile_stale_tasks(now: later(20), batch_size: 2)
      assert %{requeued: 1, unchanged: 0} = Audits.reconcile_stale_tasks(now: later(20))
      assert length(scan_jobs()) == 3
    end

    test "tarefas antigas com job vivo não ocupam o lote" do
      audit = audit_fixture(%{page_limit: 3})

      # As mais antigas esperam na fila cheia, com job vivo.
      for path <- ~w(a b) do
        page =
          page_fixture(%{
            audit: audit,
            url: "https://exemplo.com/#{path}",
            task: %{updated_at: ago(120), inserted_at: ago(120)}
          })

        scan_job(page, "available")
      end

      stuck =
        page_fixture(%{
          audit: audit,
          url: "https://exemplo.com/presa",
          task: %{updated_at: ago(60), inserted_at: ago(60)}
        })

      assert %{requeued: 1, unchanged: 0} = Audits.reconcile_stale_tasks(batch_size: 1)
      assert %PageTask{requeues: 1} = task(stuck)
    end
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
        oban: Application.fetch_env!(:rampa, Oban)
      }
    end

    test "o Cron agenda o ReconcileTasksJob", %{oban: oban} do
      assert {_expr, ReconcileTasksJob} =
               Enum.find(oban[:cron][:crontab], &match?({_, ReconcileTasksJob}, &1))
    end

    test "o Lifeline nunca resgata um ScanPageJob vivo e o prazo interno vem antes do timeout",
         %{oban: oban} do
      rescue_after = Oban.Period.to_milliseconds(oban[:lifeline][:rescue_after])
      job_timeout = ScanPageJob.timeout(%Oban.Job{})
      deadline = Application.fetch_env!(:rampa, :scan_deadline_ms)

      # Uma varredura: DNS (5 s) + cliente do scanner (100 s), com folga para gravar.
      assert deadline > :timer.seconds(105)
      assert job_timeout > deadline
      assert rescue_after > job_timeout
    end
  end

  # RF-RA004: a reconciliação publica pelo mesmo caminho dos jobs.
  describe "eventos do canal" do
    alias Rampa.Audits.Events
    alias Rampa.Audits.Events.Event

    defp received do
      receive do
        {:audit_event, %Event{name: name, revision: revision}} -> [{name, revision} | received()]
      after
        0 -> []
      end
    end

    test "tarefa presa fechada: page_failed e audit_failed, com a revision gravada" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 2, started_at: ago(20)}})
      :ok = Events.subscribe(page.audit_id)

      assert %{failed: 1} = Audits.reconcile_stale_tasks()

      revision = audit_of(page).revision
      assert [{:page_failed, ^revision}, {:audit_failed, ^revision}] = received()

      # Rodar de novo não muda nada nem publica.
      assert %{failed: 0} = Audits.reconcile_stale_tasks()
      assert received() == []
    end

    test "tarefa reenfileirada não muda o andamento: nenhum evento, revision parada" do
      page = page_fixture(%{status: :scanning, task: %{attempt: 1, started_at: ago(20)}})
      :ok = Events.subscribe(page.audit_id)
      before = audit_of(page).revision

      assert %{requeued: 1} = Audits.reconcile_stale_tasks()

      assert received() == []
      assert audit_of(page).revision == before
    end
  end
end
