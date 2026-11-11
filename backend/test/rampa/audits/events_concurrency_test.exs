defmodule Rampa.Audits.EventsConcurrencyTest do
  @moduledoc """
  RF-RA004 com transações reais e concorrentes (PRD §9; adendo ao ADR 0001):

    * a auditoria é concluída, e `audit_completed` publicado, uma vez só, mesmo com dois
      processos fechando as últimas tarefas ao mesmo tempo, ou um job e a reconciliação;
    * o snapshot é atômico: nunca sai `revision` N+1 com os totais de N;
    * convergência: com transições concorrentes de várias páginas e joins no canal no meio, o
      estado a que o cliente chega (snapshot do join mais eventos, pela regra do §9) é o do
      `GET /api/audits/:id`, com exatamente uma conclusão anunciada.

  Fora do sandbox: o modo do pool é `:auto` durante o módulo, então cada processo (os de
  escrita, os canais, o `GET`) usa a própria conexão e o `COMMIT` acontece de verdade. Por
  isso o módulo é `async: false` (os módulos síncronos rodam sozinhos, depois dos
  assíncronos) e apaga o que criou no `on_exit`.
  """

  use ExUnit.Case, async: false
  use ExUnitProperties

  import Ecto.Query, only: [from: 2]
  import Phoenix.ChannelTest
  import Phoenix.ConnTest, only: [build_conn: 0, get: 2, json_response: 2]
  import Rampa.AuditsFixtures
  import RampaWeb.ChannelContract

  alias Ecto.Adapters.SQL.Sandbox
  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Events}
  alias Rampa.Audits.Events.Event
  alias Rampa.Repo
  alias RampaWeb.{AuditChannel, AuditSocket}
  alias StreamData, as: SD

  @endpoint RampaWeb.Endpoint

  @final ~w(completed failed cancelled)

  setup do
    prefix = "https://concorrencia-#{System.unique_integer([:positive])}.exemplo/"
    :ok = Sandbox.mode(Repo, :auto)

    on_exit(fn ->
      Repo.delete_all(from a in Audit, where: like(a.start_url, ^"#{prefix}%"))
      Sandbox.mode(Repo, :manual)
    end)

    %{prefix: prefix}
  end

  # Auditoria com `n` páginas `queued`, cada uma com a tarefa `scan` `pending`.
  defp audit_with_pages(prefix, n) do
    audit = audit_fixture(%{start_url: prefix <> "#{System.unique_integer([:positive])}"})
    pages = for i <- 1..n, do: page_fixture(%{audit: audit, url: "#{audit.start_url}/#{i}"})
    {audit, pages}
  end

  # Roda as funções em processos próprios e solta todas ao mesmo tempo.
  defp concurrently(funs) do
    parent = self()

    tasks =
      for fun <- funs do
        Task.async(fn ->
          send(parent, {:ready, self()})

          receive do
            :go -> fun.()
          end
        end)
      end

    for _ <- tasks, do: receive(do: ({:ready, _pid} -> :ok))
    Enum.each(tasks, &send(&1.pid, :go))
    Task.await_many(tasks, 30_000)
  end

  # Eventos de domínio recebidos até agora: `{nome, revision}`, na ordem de chegada.
  defp received do
    receive do
      {:audit_event, %Event{name: name, revision: revision}} -> [{name, revision} | received()]
    after
      0 -> []
    end
  end

  defp count(events, name), do: Enum.count(events, &match?({^name, _}, &1))

  describe "uma conclusão só" do
    @tag :capture_log
    test "dois processos fechando as últimas tarefas ao mesmo tempo", %{prefix: prefix} do
      for _round <- 1..10 do
        {audit, [first, second]} = audit_with_pages(prefix, 2)
        :ok = Events.subscribe(audit.id)

        for page <- [first, second], do: {:ok, _task} = Audits.start_task(page.id, :scan, 1)

        results =
          concurrently(
            for page <- [first, second] do
              fn -> Audits.record_scan_result(page, scanner_response("img-sem-alt")) end
            end
          )

        assert Enum.all?(results, &match?({:ok, _page}, &1))

        events = received()
        assert count(events, :audit_completed) == 1
        assert count(events, :page_scanned) == 2

        revisions = for {:page_scanned, revision} <- events, do: revision
        assert length(Enum.uniq(revisions)) == 2

        assert %Audit{status: :completed, revision: final} = Repo.get!(Audit, audit.id)
        assert {:audit_completed, final} in events
      end
    end

    @tag :capture_log
    test "o job e a reconciliação fechando a mesma tarefa", %{prefix: prefix} do
      for _round <- 1..10 do
        {audit, [page]} = audit_with_pages(prefix, 1)
        :ok = Events.subscribe(audit.id)
        {:ok, _task} = Audits.start_task(page.id, :scan, 2)
        received()

        # A tarefa parece presa para a reconciliação (sem job vivo, iniciada há 20 min).
        Repo.update_all(
          from(t in Rampa.Audits.PageTask, where: t.page_id == ^page.id),
          set: [started_at: DateTime.add(DateTime.utc_now(:second), -1_200)]
        )

        concurrently([
          fn -> Audits.record_scan_result(page, scanner_response("img-sem-alt")) end,
          fn -> Audits.reconcile_stale_tasks() end
        ])

        events = received()
        page_events = count(events, :page_scanned) + count(events, :page_failed)
        final_events = count(events, :audit_completed) + count(events, :audit_failed)

        assert page_events == 1
        assert final_events == 1
      end
    end
  end

  describe "snapshot atômico" do
    # Cada página tem um achado crítico confirmado. Em ordem, sem concorrência entre
    # escritores: `start_task` sobe a revision para ímpar, `record_scan_result` para par.
    # Então, em qualquer instante gravado, críticos = páginas varridas = div(revision, 2).
    test "nunca sai revision N+1 com os totais de N", %{prefix: prefix} do
      {audit, pages} = audit_with_pages(prefix, 20)
      parent = self()

      reader =
        Task.async(fn ->
          send(parent, :reading)
          read_until_stop(audit.id, [])
        end)

      assert_receive :reading

      for page <- pages do
        {:ok, _task} = Audits.start_task(page.id, :scan, 1)
        {:ok, _page} = Audits.record_scan_result(page, scanner_response("img-sem-alt"))
      end

      send(reader.pid, :stop)
      samples = Task.await(reader, 30_000)

      assert length(samples) > 20

      for %{revision: revision, progress: progress} <- samples do
        expected = div(revision, 2)

        assert {revision, progress.totals_by_severity.critical, progress.pages_scanned} ==
                 {revision, expected, expected}
      end
    end
  end

  defp read_until_stop(audit_id, samples) do
    receive do
      :stop -> samples
    after
      0 ->
        {:ok, snapshot} = Audits.get_progress(audit_id)
        read_until_stop(audit_id, [snapshot | samples])
    end
  end

  describe "corrida entre o snapshot e a inscrição" do
    # O caso em que perder um evento não tem conserto pelo evento seguinte: a última transição
    # (a conclusão) acontece ao mesmo tempo que o join. Se o canal lesse o snapshot antes de se
    # inscrever, uma conclusão gravada e publicada entre as duas coisas se perderia, e o
    # cliente ficaria em `running` para sempre.
    test "o join ao mesmo tempo que a conclusão nunca perde o evento final", %{prefix: prefix} do
      for _round <- 1..150 do
        {audit, [page]} = audit_with_pages(prefix, 1)
        {:ok, _task} = Audits.start_task(page.id, :scan, 1)

        # O socket do teste só pode ser montado no processo do teste; o join roda no outro.
        connection = new_connection()

        [client, {:ok, _page}] =
          concurrently([
            fn -> open_client(connection, audit.id) end,
            fn -> Audits.record_scan_result(page, scanner_response("limpa")) end
          ])

        final = Repo.get!(Audit, audit.id).revision
        state = converge(client, final, 50)

        assert state.revision == final
        assert state.progress["status"] == "completed"
        close_client(client)
      end
    end
  end

  describe "corrida entre o snapshot e a inscrição, determinística" do
    # O canal é pausado logo depois de ler o snapshot (no evento de telemetria do join), a
    # conclusão é gravada e publicada nesse intervalo, e só então o join termina. Como a
    # inscrição vem antes do snapshot, o evento final já está na caixa do canal e sai.
    test "conclusão publicada entre o snapshot e o fim do join chega ao cliente",
         %{prefix: prefix} do
      {audit, [page]} = audit_with_pages(prefix, 1)
      {:ok, _task} = Audits.start_task(page.id, :scan, 1)
      handler = "pausa-#{audit.id}"
      test_pid = self()
      audit_id = audit.id

      :ok =
        :telemetry.attach(
          handler,
          [:rampa, :audit_channel, :snapshot],
          fn _event, _measurements, metadata, _config ->
            if metadata.audit_id == audit_id do
              send(test_pid, {:paused, self()})
              receive(do: (:continue -> :ok))
            end
          end,
          nil
        )

      on_exit(fn -> :telemetry.detach(handler) end)

      connection = new_connection()
      joining = Task.async(fn -> open_client(connection, audit.id) end)
      assert_receive {:paused, channel_pid}, 5_000

      assert {:ok, _page} = Audits.record_scan_result(page, scanner_response("limpa"))
      send(channel_pid, :continue)

      client = Task.await(joining)
      assert client.snapshot["progress"]["status"] == "running"

      final = Repo.get!(Audit, audit.id).revision
      state = converge(client, final, 100)

      assert state.revision == final
      assert state.progress["status"] == "completed"
      assert state.announced == 1
      close_client(client)
    end
  end

  describe "convergência do cliente (propriedade)" do
    @describetag :capture_log

    property "snapshot + eventos pela regra do cliente = GET /api/audits/:id", %{prefix: prefix} do
      check all outcomes <-
                  SD.list_of(SD.member_of([:scanned, :failed]), min_length: 2, max_length: 4),
                delays <- SD.list_of(SD.integer(0..4), length: 3),
                max_runs: 12 do
        {audit, pages} = audit_with_pages(prefix, length(outcomes))
        :ok = Events.subscribe(audit.id)

        # Um cliente antes de tudo; os outros entram durante as transições; um depois do fim.
        early = open_client(audit.id)

        writers =
          for {page, outcome} <- Enum.zip(pages, outcomes) do
            Task.async(fn -> transition(page, outcome) end)
          end

        middle =
          for delay <- delays do
            Process.sleep(delay)
            open_client(audit.id)
          end

        Task.await_many(writers, 30_000)
        late = open_client(audit.id)

        summary = build_conn() |> get("/api/audits/#{audit.id}") |> json_response(200)
        assert summary["status"] in @final

        for client <- [early | middle] ++ [late] do
          state = converge(client, summary["revision"])

          assert state.revision == summary["revision"]
          assert state.progress == Map.take(summary, Map.keys(state.progress))

          # A conclusão é anunciada uma vez por quem viu a auditoria aberta, e nenhuma por
          # quem já entrou com ela encerrada.
          expected = if client.snapshot_final?, do: 0, else: 1
          assert state.announced == expected

          close_client(client)
        end

        events = received()
        assert count(events, :audit_completed) + count(events, :audit_failed) == 1

        if :scanned in outcomes,
          do: assert(count(events, :audit_completed) == 1),
          else: assert(count(events, :audit_failed) == 1)
      end
    end
  end

  defp transition(page, :scanned) do
    {:ok, _task} = Audits.start_task(page.id, :scan, 1)
    {:ok, _page} = Audits.record_scan_result(page, scanner_response("img-sem-alt"))
  end

  defp transition(page, :failed) do
    {:ok, _task} = Audits.start_task(page.id, :scan, 1)
    {:ok, _page} = Audits.fail_task(page.id, :scan, :timeout)
  end

  # Um cliente = uma conexão própria (o processo coletor faz o papel do transporte e recebe os
  # pushes do canal, na ordem em que saem).
  defp open_client(audit_id), do: open_client(new_connection(), audit_id)

  defp open_client(%{collector: collector, socket: socket}, audit_id) do
    {:ok, reply, channel} = join(socket, AuditChannel, "audit:" <> audit_id)
    Process.unlink(channel.channel_pid)
    reply = assert_contract(:join_reply, reply)

    %{
      collector: collector,
      channel: channel,
      snapshot: reply,
      snapshot_final?: reply["progress"]["status"] in @final
    }
  end

  defp new_connection do
    collector = spawn(fn -> collect([]) end)
    %{collector: collector, socket: %{socket(AuditSocket) | transport_pid: collector}}
  end

  defp close_client(%{collector: collector, channel: channel}) do
    Process.exit(channel.channel_pid, :kill)
    Process.exit(collector, :kill)
  end

  defp collect(pushes) do
    receive do
      {:pushes, from} ->
        send(from, {:pushes, self(), Enum.reverse(pushes)})
        collect(pushes)

      %Phoenix.Socket.Message{} = message ->
        collect([message | pushes])

      _other ->
        collect(pushes)
    end
  end

  # Aplica a regra do cliente (PRD §9) até chegar à revision esperada, ou desiste em 2 s.
  defp converge(client, target, tries \\ 200) do
    send(client.collector, {:pushes, self()})
    collector = client.collector
    pushes = receive(do: ({:pushes, ^collector, pushes} -> pushes))

    state = apply_rule(client.snapshot, pushes)

    if state.revision >= target or tries == 0 do
      state
    else
      Process.sleep(10)
      converge(client, target, tries - 1)
    end
  end

  # Regra do cliente: fica com o `progress` de maior `revision`; anuncia a conclusão quando o
  # status local passa de não final a final.
  defp apply_rule(snapshot, pushes) do
    initial = %{revision: snapshot["revision"], progress: snapshot["progress"], announced: 0}

    Enum.reduce(pushes, initial, fn %Phoenix.Socket.Message{event: event, payload: payload},
                                    state ->
      payload = assert_contract(event, payload)

      if payload["revision"] > state.revision do
        was_final? = state.progress["status"] in @final
        now_final? = payload["progress"]["status"] in @final

        %{
          state
          | revision: payload["revision"],
            progress: payload["progress"],
            announced: state.announced + if(not was_final? and now_final?, do: 1, else: 0)
        }
      else
        state
      end
    end)
  end
end
