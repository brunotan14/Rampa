defmodule Rampa.Audits.CreateAuditConcurrencyTest do
  @moduledoc """
  RF-RA002: os limites valem com requisições simultâneas, sem condição de corrida.

  Aqui as transações são reais e concorrentes: cada chamada roda num processo com a própria
  conexão **fora do sandbox** (`Sandbox.checkout(Repo, sandbox: false)`), então as travas
  consultivas e o `COMMIT` acontecem de verdade. Por isso o módulo é `async: false` (o
  ExUnit roda os módulos síncronos depois dos assíncronos, e um de cada vez: nenhum outro
  teste enxerga as linhas gravadas aqui) e apaga o que criou no `on_exit`.

  As URLs são IPs públicos literais: não há consulta de DNS nem Mox entre processos.
  """

  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Limits, Page}
  alias Rampa.Repo

  @calls 12
  @url "https://93.184.215.14/"

  setup do
    # Prefixo único desta rodada: a limpeza apaga só o que este módulo criou.
    prefix = "concorrencia-#{System.unique_integer([:positive])}-"
    :ok = Sandbox.checkout(Repo, sandbox: false)

    on_exit(fn ->
      :ok = Sandbox.checkout(Repo, sandbox: false)
      cleanup(prefix)
      Sandbox.checkin(Repo)
    end)

    %{prefix: prefix}
  end

  defp cleanup(prefix) do
    audits = from a in Audit, where: like(a.requester_ip_hash, ^"#{prefix}%"), select: a.id
    pages = from p in Page, where: p.audit_id in subquery(audits), select: type(p.id, :string)

    Repo.delete_all(
      from j in Oban.Job,
        where: j.worker == "Rampa.Audits.ScanPageJob",
        where: fragment("?->>'page_id'", j.args) in subquery(pages)
    )

    # Páginas, tarefas e achados vão junto (ON DELETE CASCADE).
    Repo.delete_all(from a in Audit, where: a.id in subquery(audits))
  end

  # Roda `fun.(i)` em `@calls` processos, cada um com a sua conexão real, e solta todos
  # ao mesmo tempo depois de todos estarem prontos.
  defp concurrently(fun) do
    parent = self()

    tasks =
      for i <- 1..@calls do
        Task.async(fn ->
          :ok = Sandbox.checkout(Repo, sandbox: false)
          send(parent, {:ready, self()})

          receive do
            :go -> :ok
          end

          try do
            fun.(i)
          after
            Sandbox.checkin(Repo)
          end
        end)
      end

    pids = for _ <- tasks, do: receive(do: ({:ready, pid} -> pid))
    Enum.each(pids, &send(&1, :go))

    Task.await_many(tasks, 30_000)
  end

  defp created(prefix) do
    Repo.aggregate(from(a in Audit, where: like(a.requester_ip_hash, ^"#{prefix}%")), :count)
  end

  test "#{@calls} chamadas simultâneas do mesmo IP com limite 5 criam exatamente 5",
       %{prefix: prefix} do
    requester = %{ip_hash: prefix <> "mesmo-ip"}

    results =
      concurrently(fn _i ->
        Audits.create_audit(@url, requester, limits: [per_ip_per_hour: 5, daily: 1_000_000])
      end)

    assert Enum.count(results, &match?({:ok, %Audit{}}, &1)) == 5
    assert Enum.count(results, &match?({:error, {:rate_limited, %DateTime{}}}, &1)) == @calls - 5
    assert created(prefix) == 5
  end

  test "#{@calls} chamadas simultâneas de IPs diferentes respeitam o teto diário",
       %{prefix: prefix} do
    # Auditorias de hoje que já existam no banco de teste entram na conta.
    today =
      Repo.aggregate(
        from(a in Audit, where: a.inserted_at >= ^Limits.day_start(DateTime.utc_now())),
        :count
      )

    results =
      concurrently(fn i ->
        Audits.create_audit(@url, %{ip_hash: prefix <> "ip-#{i}"},
          limits: [per_ip_per_hour: 5, daily: today + 5]
        )
      end)

    assert Enum.count(results, &match?({:ok, %Audit{}}, &1)) == 5

    assert Enum.count(results, &match?({:error, {:daily_limit_reached, %DateTime{}}}, &1)) ==
             @calls - 5

    assert created(prefix) == 5
  end

  test "chamadas simultâneas com a mesma Idempotency-Key criam uma auditoria só",
       %{prefix: prefix} do
    requester = %{ip_hash: prefix <> "idempotente"}

    results =
      concurrently(fn _i ->
        Audits.create_audit(@url, requester,
          idempotency_key: "mesma-chave",
          limits: [per_ip_per_hour: 1, daily: 1_000_000]
        )
      end)

    ids = for {:ok, %Audit{id: id}} <- results, uniq: true, do: id

    assert length(ids) == 1
    assert Enum.all?(results, &match?({:ok, %Audit{}}, &1))
    assert created(prefix) == 1
  end

  test "o inserted_at da auditoria é tomado depois das travas consultivas", %{prefix: prefix} do
    ip_hash = prefix <> "espera"
    parent = self()

    # Outra transação segura a trava do solicitante.
    holder =
      Task.async(fn ->
        :ok = Sandbox.checkout(Repo, sandbox: false)

        Repo.transact(fn ->
          :ok = Limits.lock_requester(ip_hash)
          send(parent, :locked)

          receive do
            :release -> {:ok, :released}
          end
        end)
      end)

    assert_receive :locked, 5_000

    creator =
      Task.async(fn ->
        :ok = Sandbox.checkout(Repo, sandbox: false)
        Audits.create_audit(@url, %{ip_hash: ip_hash})
      end)

    # A criação fica esperando a trava por mais de um segundo.
    Process.sleep(1_200)
    released_at = DateTime.utc_now(:second)
    send(holder.pid, :release)

    assert {:ok, {:ok, :released}} = {:ok, Task.await(holder)}
    assert {:ok, %Audit{} = audit} = Task.await(creator)
    assert DateTime.compare(audit.inserted_at, released_at) != :lt
  end
end
