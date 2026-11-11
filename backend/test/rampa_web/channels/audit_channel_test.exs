defmodule RampaWeb.AuditChannelTest do
  @moduledoc """
  RF-RA004: o canal `audit:<id>` (PRD §9). Todo payload recebido (join, recusa e eventos) é
  conferido contra `shared/channel-events.schema.json`.
  """

  use RampaWeb.ChannelCase, async: true

  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias Rampa.Audits.Events.Event
  alias RampaWeb.{AuditChannel, AuditSocket}

  defp join_audit(id, socket \\ socket(AuditSocket)),
    do: subscribe_and_join(socket, AuditChannel, "audit:" <> id)

  # Recebe o próximo push do evento e confere o payload contra o contrato.
  defmacrop assert_event(event) do
    quote do
      assert_push(unquote(event), payload)
      assert_contract(unquote(event), payload)
    end
  end

  defp event(audit_id, name, revision, data \\ %{}) do
    %Event{
      name: name,
      audit_id: audit_id,
      revision: revision,
      progress: %{
        status: :running,
        pages_found: 1,
        pages_scanned: 0,
        pages_failed: 0,
        totals_by_severity: %{critical: 0, serious: 0, moderate: 0, minor: 0},
        needs_review_count: 0,
        error: nil
      },
      data: data
    }
  end

  describe "join" do
    test "devolve o snapshot atual: revision e progress absolutos" do
      audit = audit_fixture(%{status: :running, revision: 4, pages_found: 2, pages_scanned: 1})
      page = page_fixture(%{audit: audit, status: :done})
      finding_fixture(page, %{severity: :serious})
      finding_fixture(page, %{severity: :minor, needs_review: true})

      assert {:ok, reply, socket} = join_audit(audit.id)

      assert %{
               "revision" => 4,
               "progress" => %{
                 "status" => "running",
                 "pages_found" => 2,
                 "pages_scanned" => 1,
                 "pages_failed" => 0,
                 "totals_by_severity" => %{"serious" => 1, "critical" => 0},
                 "needs_review_count" => 1,
                 "error" => nil
               }
             } = assert_contract(:join_reply, reply)

      assert socket.assigns.revision == 4
    end

    test "auditoria failed traz o erro com a mensagem pronta" do
      audit = audit_fixture(%{status: :failed, error: "blocked_address"})

      assert {:ok, reply, _socket} = join_audit(audit.id)

      assert %{"progress" => %{"status" => "failed", "error" => error}} =
               assert_contract(:join_reply, reply)

      assert %{"code" => "blocked_address", "message" => "Este endereço não pode" <> _} = error
    end

    test "auditoria encerrada aceita join: o snapshot já é o estado final" do
      audit = audit_fixture(%{status: :completed})

      assert {:ok, reply, _socket} = join_audit(audit.id)
      assert %{"progress" => %{"status" => "completed"}} = assert_contract(:join_reply, reply)
    end

    test "id inválido, fora do formato canônico ou inexistente: a mesma recusa" do
      audit = audit_fixture()

      for id <- [
            "nao-e-uuid",
            "",
            String.upcase(audit.id),
            String.replace(audit.id, "-", ""),
            Ecto.UUID.generate()
          ] do
        assert {:error, reply} = join_audit(id)

        assert %{"error" => %{"code" => "audit_not_found", "message" => message}} =
                 assert_contract(:join_error, reply)

        assert message =~ "Auditoria não encontrada"
      end
    end

    test "no máximo 10 canais por conexão" do
      socket = socket(AuditSocket)
      audits = for _ <- 1..11, do: audit_fixture()

      for audit <- Enum.take(audits, 10),
          do: assert({:ok, _reply, _socket} = join_audit(audit.id, socket))

      assert {:error, reply} = join_audit(List.last(audits).id, socket)

      assert %{"error" => %{"code" => "channel_limit_reached"}} =
               assert_contract(:join_error, reply)

      # Outra conexão (outro processo de transporte) tem o próprio limite.
      other = %{socket(AuditSocket) | transport_pid: spawn(fn -> Process.sleep(:infinity) end)}
      assert {:ok, _reply, _socket} = join_audit(List.last(audits).id, other)
    end

    test "no limite, id inválido ainda é audit_not_found: o id é conferido antes do limite" do
      socket = socket(AuditSocket)
      for _ <- 1..10, do: assert({:ok, _reply, _socket} = join_audit(audit_fixture().id, socket))

      assert {:error, reply} = join_audit("nao-e-uuid", socket)
      assert %{"error" => %{"code" => "audit_not_found"}} = assert_contract(:join_error, reply)
    end

    test "auditoria inexistente devolve a vaga antes da recusa" do
      socket = socket(AuditSocket)
      for _ <- 1..9, do: assert({:ok, _reply, _socket} = join_audit(audit_fixture().id, socket))

      # Com a partição do `Registry` suspensa, a entrada de um processo que termina não é
      # limpa: só o desregistro explícito do canal devolve a vaga.
      partition = Process.whereis(Module.concat(RampaWeb.AuditChannel.Registry, "PIDPartition0"))
      :ok = :sys.suspend(partition)

      try do
        assert {:error, reply} = join_audit(Ecto.UUID.generate(), socket)
        assert %{"error" => %{"code" => "audit_not_found"}} = assert_contract(:join_error, reply)
        assert Registry.count_match(RampaWeb.AuditChannel.Registry, self(), :_) == 9
      after
        :sys.resume(partition)
      end

      assert {:ok, _reply, _socket} = join_audit(audit_fixture().id, socket)
    end

    test "um canal que sai libera a vaga" do
      socket = socket(AuditSocket)
      audits = for _ <- 1..11, do: audit_fixture()

      joined = for audit <- Enum.take(audits, 10), do: elem(join_audit(audit.id, socket), 2)
      assert {:error, _reply} = join_audit(List.last(audits).id, socket)

      first = hd(joined)
      Process.unlink(first.channel_pid)
      ref = leave(first)
      assert_reply ref, :ok
      wait_until_down(first.channel_pid)

      # O `Registry` apaga a entrada do processo que saiu de forma assíncrona.
      assert eventually(fn -> match?({:ok, _, _}, join_audit(List.last(audits).id, socket)) end)
    end
  end

  describe "eventos" do
    setup do
      page = page_fixture()
      {:ok, _reply, socket} = join_audit(page.audit_id)
      %{page: page, socket: socket}
    end

    test "a varredura publica status_changed, page_scanned e audit_completed, na ordem",
         %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)

      assert %{"status" => "running", "revision" => started} = assert_event("status_changed")

      assert {:ok, _page} = Audits.record_scan_result(page, scanner_response("img-sem-alt"))

      assert %{
               "page_id" => page_id,
               "counts_by_severity" => %{"critical" => 1},
               "revision" => scanned,
               "progress" => %{"pages_scanned" => 1, "totals_by_severity" => %{"critical" => 1}}
             } = assert_event("page_scanned")

      assert page_id == page.id
      assert scanned > started

      assert %{"score" => nil, "revision" => ^scanned, "progress" => %{"status" => "completed"}} =
               assert_event("audit_completed")

      refute_push "page_failed", _payload
    end

    test "a falha publica page_failed e audit_failed, com o erro pronto", %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert_event("status_changed")

      assert {:ok, _page} = Audits.fail_task(page.id, :scan, :timeout)

      assert %{"error" => %{"code" => "timeout", "message" => _}} = assert_event("page_failed")

      assert %{"progress" => %{"status" => "failed", "error" => %{"code" => "timeout"}}} =
               assert_event("audit_failed")
    end

    test "o payload não leva URL, seletor, trecho de HTML nem dados de quem pediu",
         %{page: page} do
      assert {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      assert {:ok, _page} = Audits.record_scan_result(page, scanner_response("img-sem-alt"))

      for event <- ~w(status_changed page_scanned audit_completed) do
        assert_push ^event, payload
        encoded = Jason.encode!(payload)

        refute encoded =~ "exemplo.com"
        refute encoded =~ "<img"
        refute encoded =~ "ip_hash"
        refute encoded =~ "idempotency"
      end
    end
  end

  describe "revisão do snapshot (A4)" do
    setup do
      audit = audit_fixture(%{status: :running, revision: 5})
      {:ok, _reply, socket} = join_audit(audit.id)
      %{audit: audit, socket: socket}
    end

    test "evento com revision menor ou igual à do snapshot não sai", %{
      audit: audit,
      socket: socket
    } do
      send(
        socket.channel_pid,
        {:audit_event, event(audit.id, :status_changed, 4, %{status: :running})}
      )

      send(
        socket.channel_pid,
        {:audit_event, event(audit.id, :status_changed, 5, %{status: :running})}
      )

      refute_push "status_changed", _payload
    end

    test "N+2 antes de N+1, os dois acima do snapshot: saem os dois, na ordem de chegada",
         %{audit: audit, socket: socket} do
      page_a = Ecto.UUID.generate()
      page_b = Ecto.UUID.generate()
      counts = %{critical: 0, serious: 0, moderate: 0, minor: 0}
      data = &%{page_id: &1, counts_by_severity: counts, needs_review_count: 0}

      send(socket.channel_pid, {:audit_event, event(audit.id, :page_scanned, 7, data.(page_b))})
      send(socket.channel_pid, {:audit_event, event(audit.id, :page_scanned, 6, data.(page_a))})

      assert %{"revision" => 7, "page_id" => ^page_b} = assert_event("page_scanned")
      assert %{"revision" => 6, "page_id" => ^page_a} = assert_event("page_scanned")
    end

    test "eventos da mesma transação, com a mesma revision, saem todos", %{
      audit: audit,
      socket: socket
    } do
      page_id = Ecto.UUID.generate()

      send(
        socket.channel_pid,
        {:audit_event, event(audit.id, :page_failed, 6, %{page_id: page_id, error: "timeout"})}
      )

      send(socket.channel_pid, {:audit_event, event(audit.id, :audit_failed, 6)})

      assert %{"revision" => 6} = assert_event("page_failed")
      assert %{"revision" => 6} = assert_event("audit_failed")
    end
  end

  test "mensagem do cliente é ignorada" do
    audit = audit_fixture()
    {:ok, _reply, socket} = join_audit(audit.id)

    ref = push(socket, "qualquer_coisa", %{"a" => 1})
    refute_reply ref, _status
    assert Process.alive?(socket.channel_pid)
  end

  defp eventually(fun, tries \\ 50) do
    cond do
      fun.() -> true
      tries == 0 -> false
      true -> retry_later(fun, tries)
    end
  end

  defp retry_later(fun, tries) do
    Process.sleep(10)
    eventually(fun, tries - 1)
  end

  defp wait_until_down(pid) do
    ref = Process.monitor(pid)
    assert_receive {:DOWN, ^ref, :process, ^pid, _reason}
  end
end
