defmodule Rampa.Audits.RetentionConcurrencyTest do
  @moduledoc """
  FR-014: a limpeza da retenção (`Rampa.Audits.purge_expired/1`) com uma auditoria vencida
  travada por outra transação, de verdade.

  Como em `Rampa.Audits.CreateAuditConcurrencyTest`, cada processo usa a própria conexão **fora
  do sandbox**: o `FOR UPDATE SKIP LOCKED` e o `COMMIT` acontecem de verdade. Por isso o módulo
  é `async: false` e apaga o que criou no `on_exit`. As datas são do ano 2000 e a limpeza usa
  `now:` do mesmo ano: nenhuma outra auditoria do banco de teste vence nesse relógio.
  """

  use ExUnit.Case, async: false

  import Ecto.Query
  import Rampa.AuditsFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Page}
  alias Rampa.Repo

  @now ~U[2000-06-01 12:00:00Z]
  @expired ~U[2000-01-01 00:00:00Z]

  setup do
    :ok = Sandbox.checkout(Repo, sandbox: false)

    locked = audit_fixture(%{expires_at: @expired, inserted_at: @expired, updated_at: @expired})
    free = audit_fixture(%{expires_at: @expired, inserted_at: @expired, updated_at: @expired})
    page_fixture(%{audit: locked, status: :done})
    page_fixture(%{audit: free, status: :done})
    ids = [locked.id, free.id]

    on_exit(fn ->
      :ok = Sandbox.checkout(Repo, sandbox: false)
      Repo.delete_all(from a in Audit, where: a.id in ^ids)
      Sandbox.checkin(Repo)
    end)

    %{locked: locked, free: free}
  end

  defp exists?(%Audit{id: id}), do: Repo.exists?(from a in Audit, where: a.id == ^id)
  defp pages(%Audit{id: id}), do: Repo.all(from p in Page, where: p.audit_id == ^id)

  # Segura a trava da auditoria numa transação de outra conexão até receber `:release`.
  defp hold_lock(%Audit{id: id}) do
    parent = self()

    task =
      Task.async(fn ->
        :ok = Sandbox.checkout(Repo, sandbox: false)

        try do
          Repo.transact(fn ->
            Repo.one!(from a in Audit, where: a.id == ^id, lock: "FOR UPDATE")
            send(parent, :locked)

            receive do
              :release -> {:ok, :released}
            end
          end)
        after
          Sandbox.checkin(Repo)
        end
      end)

    assert_receive :locked, 5_000
    task
  end

  test "FR-014 auditoria travada por outra transação é pulada sem esperar e sai na execução seguinte",
       %{locked: locked, free: free} do
    task = hold_lock(locked)

    {elapsed_us, result} = :timer.tc(fn -> Audits.purge_expired(now: @now) end)

    send(task.pid, :release)
    assert {:ok, :released} = Task.await(task, 5_000)

    assert %{deleted: 1, batches: 1, more?: false} = result
    # `SKIP LOCKED`: a limpeza não ficou esperando a trava.
    assert elapsed_us < 2_000_000

    refute exists?(free)
    assert pages(free) == []
    assert exists?(locked)
    assert [_page] = pages(locked)

    assert %{deleted: 1} = Audits.purge_expired(now: @now)
    refute exists?(locked)
    assert pages(locked) == []
  end
end
