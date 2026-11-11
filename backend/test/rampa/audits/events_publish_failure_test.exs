defmodule Rampa.Audits.EventsPublishFailureTest do
  @moduledoc """
  RF-RA004: falha ao publicar não desfaz nem esconde a transição. O estado já foi gravado; o
  cliente se recupera pelo snapshot do join ou pelo `GET /api/audits/:id` (PRD §9).

  Síncrono: troca o PubSub dos eventos na configuração global, e os módulos síncronos rodam
  sozinhos, depois dos assíncronos.
  """

  use Rampa.DataCase, async: false

  import ExUnit.CaptureLog
  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Page}

  setup do
    Application.put_env(:rampa, :audit_events_pubsub, :pubsub_que_nao_existe)
    on_exit(fn -> Application.delete_env(:rampa, :audit_events_pubsub) end)
  end

  test "a transição devolve {:ok, _}, grava o estado e registra a falha sem o conteúdo" do
    page = page_fixture()

    log =
      capture_log(fn ->
        assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)

        assert {:ok, %Page{status: :done}} =
                 Audits.record_scan_result(page, scanner_response("img-sem-alt"))
      end)

    assert %Audit{status: :completed, pages_scanned: 1} = Repo.get!(Audit, page.audit_id)

    assert log =~ "falha ao publicar status_changed"
    assert log =~ "falha ao publicar page_scanned"
    assert log =~ "falha ao publicar audit_completed"
    assert log =~ page.audit_id
    refute log =~ "totals_by_severity"
    refute log =~ "critical"
  end
end
