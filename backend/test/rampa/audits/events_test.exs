defmodule Rampa.Audits.EventsTest do
  @moduledoc """
  RF-RA004: eventos de andamento derivados do diff de estado e publicados só depois do commit
  (PRD §9; adendo ao ADR 0001).
  """

  use Rampa.DataCase, async: true

  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Events, Page}
  alias Rampa.Audits.Events.Event

  defp audit(status, extra \\ %{}), do: struct!(Audit, Map.put(extra, :status, status))
  defp page(id, status), do: %Page{id: id, status: status, error: "timeout"}
  defp revision(audit_id), do: Repo.get!(Audit, audit_id).revision

  # Eventos recebidos até agora, na ordem: `{nome, revision}`.
  defp received do
    receive do
      {:audit_event, %Event{name: name, revision: revision}} -> [{name, revision} | received()]
    after
      0 -> []
    end
  end

  defp names(events), do: Enum.map(events, &elem(&1, 0))

  describe "diff/4 (função pura)" do
    test "status_changed só de queued para running" do
      assert [{:status_changed, %{status: :running}}] =
               Events.diff(audit(:queued), audit(:running), nil, nil)

      assert [] = Events.diff(audit(:running), audit(:running), nil, nil)
      assert [] = Events.diff(audit(:queued), audit(:queued), nil, nil)
    end

    test "page_scanned quando a página sai de queued ou scanning para analyzing ou done" do
      id = Ecto.UUID.generate()

      for before <- [:queued, :scanning], now <- [:analyzing, :done] do
        assert [{:page_scanned, %{page_id: ^id}}] =
                 Events.diff(audit(:running), audit(:running), page(id, before), page(id, now))
      end

      # A análise que termina (M4) não é uma página varrida de novo.
      assert [] =
               Events.diff(
                 audit(:running),
                 audit(:running),
                 page(id, :analyzing),
                 page(id, :done)
               )

      assert [] =
               Events.diff(
                 audit(:running),
                 audit(:running),
                 page(id, :queued),
                 page(id, :scanning)
               )
    end

    test "page_failed só quando a página passa a failed, com o erro dela" do
      id = Ecto.UUID.generate()

      assert [{:page_failed, %{page_id: ^id, error: "timeout"}}] =
               Events.diff(
                 audit(:running),
                 audit(:running),
                 page(id, :scanning),
                 page(id, :failed)
               )

      assert [] =
               Events.diff(audit(:running), audit(:running), page(id, :failed), page(id, :failed))
    end

    test "audit_completed e audit_failed só na entrada em estado final, depois dos outros" do
      id = Ecto.UUID.generate()

      assert [{:page_scanned, _}, {:audit_completed, %{score: nil}}] =
               Events.diff(
                 audit(:running),
                 audit(:completed),
                 page(id, :scanning),
                 page(id, :done)
               )

      # A entrada em estado final sai só como audit_completed ou audit_failed, nunca como
      # status_changed, mesmo direto de queued.
      assert [{:page_scanned, _}, {:audit_completed, _}] =
               Events.diff(audit(:queued), audit(:completed), page(id, :queued), page(id, :done))

      assert [{:page_failed, _}, {:audit_failed, %{}}] =
               Events.diff(audit(:queued), audit(:failed), page(id, :queued), page(id, :failed))

      assert [] = Events.diff(audit(:completed), audit(:completed), nil, nil)
      assert [] = Events.diff(audit(:running), audit(:cancelled), nil, nil)
    end

    test "páginas diferentes ou ausentes não geram evento de página" do
      assert [] =
               Events.diff(
                 audit(:running),
                 audit(:running),
                 page(Ecto.UUID.generate(), :scanning),
                 page(Ecto.UUID.generate(), :done)
               )

      assert [] =
               Events.diff(
                 audit(:running),
                 audit(:running),
                 nil,
                 page(Ecto.UUID.generate(), :done)
               )
    end
  end

  describe "publicação depois do commit" do
    setup do
      page = page_fixture()
      :ok = Events.subscribe(page.audit_id)
      %{page: page}
    end

    test "a varredura: status_changed, page_scanned e audit_completed, com revision crescente",
         %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert {:ok, _page} = Audits.record_scan_result(page, scanner_response("img-sem-alt"))

      assert [
               {:status_changed, started},
               {:page_scanned, scanned},
               {:audit_completed, scanned}
             ] = received()

      assert scanned > started
      assert revision(page.audit_id) == scanned
    end

    test "o evento leva o progress e a revision gravados na mesma transação", %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert {:ok, _page} = Audits.record_scan_result(page, scanner_response("img-sem-alt"))

      assert_received {:audit_event, %Event{name: :status_changed}}

      assert_received {:audit_event,
                       %Event{name: :page_scanned, data: data, progress: progress} = event}

      assert {:ok, %{revision: revision, progress: ^progress}} =
               Audits.get_progress(page.audit_id)

      assert event.revision == revision
      assert %{counts_by_severity: %{critical: 1}, needs_review_count: 0} = data

      assert %{status: :completed, pages_scanned: 1, totals_by_severity: %{critical: 1}} =
               progress
    end

    test "transação desfeita não publica: achado inválido no resultado", %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert [{:status_changed, before}] = received()

      # Regra sem `id`: o changeset do achado recusa, e a transação inteira é desfeita.
      bad =
        update_in(scanner_response("img-sem-alt"), ["axe", "violations"], fn [rule] ->
          [Map.delete(rule, "id")]
        end)

      assert {:error, {:invalid_finding, _changeset}} = Audits.record_scan_result(page, bad)

      assert received() == []
      assert revision(page.audit_id) == before
    end

    test "tarefa já fechada não muda nada nem publica", %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert {:ok, _page} = Audits.fail_task(page.id, :scan, :timeout)
      assert [_ | _] = received()
      before = revision(page.audit_id)

      assert {:error, :already_finished} = Audits.fail_task(page.id, :scan, :timeout)

      assert {:error, :already_finished} =
               Audits.record_scan_result(page, scanner_response("limpa"))

      assert received() == []
      assert revision(page.audit_id) == before
    end

    test "a falha do scan publica page_failed e audit_failed na mesma revision", %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert {:ok, _page} = Audits.fail_task(page.id, :scan, :http_error)

      assert [{:status_changed, _}, {:page_failed, failed}, {:audit_failed, failed}] = received()
    end

    test "falha do scan sem start_task (página ainda queued) também é page_failed",
         %{page: page} do
      assert {:ok, _page} = Audits.fail_task(page.id, :scan, :blocked_address)
      assert [:page_failed, :audit_failed] = names(received())
    end

    test "uma transição chamada dentro de outra transação levanta erro antes de publicar",
         %{page: page} do
      assert_raise ArgumentError, ~r/dentro de uma transação/, fn ->
        Repo.transact(fn -> Audits.start_task(page.id, :scan, 1) end)
      end

      assert received() == []
    end
  end

  describe "A1: eventos pelo diff de estado, não pela função chamada" do
    test "falha de análise (M4) termina a página done: sem page_failed" do
      page = page_fixture()
      :ok = Events.subscribe(page.audit_id)
      r0 = revision(page.audit_id)

      assert {:ok, _task} = Audits.add_task(page.id, :alt_text)
      r1 = revision(page.audit_id)
      assert r1 > r0

      assert {:ok, %Page{status: :analyzing}} =
               Audits.record_scan_result(page, scanner_response("img-sem-alt"))

      r2 = revision(page.audit_id)
      assert r2 > r1

      assert {:ok, %Page{status: :done}} = Audits.fail_task(page.id, :alt_text, "x")
      r3 = revision(page.audit_id)
      assert r3 > r2

      assert [{:page_scanned, ^r2}, {:audit_completed, ^r3}] = received()
    end
  end

  describe "A2: a revision sobe sempre" do
    test "start_task repetido sobe a revision e não repete status_changed" do
      page = page_fixture()
      :ok = Events.subscribe(page.audit_id)

      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      first = revision(page.audit_id)

      assert {:ok, _task} = Audits.start_task(page.id, :scan, 2)
      second = revision(page.audit_id)

      assert second > first
      assert [{:status_changed, ^first}] = received()
    end
  end

  describe "snapshot" do
    test "get_progress/1: revision e progress absolutos; id inválido ou inexistente" do
      audit = audit_fixture(%{status: :running, revision: 3, pages_found: 2})
      page = page_fixture(%{audit: audit, status: :done})
      finding_fixture(page, %{severity: :moderate})
      finding_fixture(page, %{severity: :moderate})
      finding_fixture(page, %{severity: :critical, needs_review: true})

      assert {:ok,
              %{
                revision: 3,
                progress: %{
                  status: :running,
                  pages_found: 2,
                  totals_by_severity: %{critical: 0, serious: 0, moderate: 2, minor: 0},
                  needs_review_count: 1,
                  error: nil
                }
              }} = Audits.get_progress(audit.id)

      assert {:error, :audit_not_found} = Audits.get_progress(Ecto.UUID.generate())
      assert {:error, :audit_not_found} = Audits.get_progress("nao-e-uuid")
    end

    test "auditoria sem achados tem totais zerados" do
      audit = audit_fixture()

      assert {:ok, %{progress: %{totals_by_severity: totals, needs_review_count: 0}}} =
               Audits.get_progress(audit.id)

      assert totals == %{critical: 0, serious: 0, moderate: 0, minor: 0}
    end
  end
end
