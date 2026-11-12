defmodule Rampa.Audits.LoginWallDailyConcurrencyTest do
  @moduledoc """
  RF-RA028, medição com transações reais e concorrentes: duas auditorias que terminam ao mesmo
  tempo contam as duas (o `UPSERT` da linha do dia não perde incremento), e a mesma auditoria
  fechada por dois processos ao mesmo tempo conta uma vez.

  Fora do sandbox (modo `:auto`), como `Rampa.Audits.EventsConcurrencyTest`: `async: false`,
  apaga o que criou no `on_exit` e compara a medição antes e depois.
  """

  use ExUnit.Case, async: false

  import Ecto.Query, only: [from: 2]
  import Rampa.AuditsFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias Rampa.Audits
  alias Rampa.Audits.{Audit, LoginWallDaily}
  alias Rampa.Repo

  setup do
    prefix = "https://medicao-#{System.unique_integer([:positive])}.exemplo/"
    :ok = Sandbox.mode(Repo, :auto)
    before = LoginWallDaily.summary(days: 1)

    on_exit(fn ->
      Repo.delete_all(from a in Audit, where: like(a.start_url, ^"#{prefix}%"))
      undo_counts(before)
      Sandbox.mode(Repo, :manual)
    end)

    %{prefix: prefix, before: before}
  end

  # Desfaz o que os testes somaram na linha de hoje (os testes rodam sozinhos aqui).
  defp undo_counts(before) do
    later = LoginWallDaily.summary(days: 1)

    for %{day: day} <- later.days do
      Repo.update_all(from(d in LoginWallDaily, where: d.day == ^day),
        inc: [
          audits_total: before.audits_total - later.audits_total,
          audits_with_login_wall: before.audits_with_login_wall - later.audits_with_login_wall
        ]
      )
    end
  end

  defp running_page(prefix) do
    audit = audit_fixture(%{start_url: prefix <> "#{System.unique_integer([:positive])}"})
    page_fixture(%{audit: audit, status: :scanning})
  end

  defp concurrently(funs) do
    parent = self()

    tasks =
      for fun <- funs do
        Task.async(fn ->
          send(parent, {:ready, self()})
          receive do: (:go -> fun.())
        end)
      end

    for _ <- tasks, do: receive(do: ({:ready, _pid} -> :ok))
    Enum.each(tasks, &send(&1.pid, :go))
    Task.await_many(tasks, 30_000)
  end

  defp delta(before) do
    later = LoginWallDaily.summary(days: 1)

    %{
      audits_total: later.audits_total - before.audits_total,
      audits_with_login_wall: later.audits_with_login_wall - before.audits_with_login_wall
    }
  end

  test "várias auditorias terminando juntas: todas contam", %{prefix: prefix, before: before} do
    pages = for _ <- 1..6, do: running_page(prefix)
    {with_wall, without} = Enum.split(pages, 4)

    results =
      concurrently(
        Enum.map(with_wall, fn page ->
          fn -> Audits.fail_task(page.id, :scan, :http_error, http_status: 401) end
        end) ++
          Enum.map(without, fn page ->
            fn -> Audits.fail_task(page.id, :scan, :http_error, http_status: 404) end
          end)
      )

    assert Enum.all?(results, &match?({:ok, _page}, &1))
    assert delta(before) == %{audits_total: 6, audits_with_login_wall: 4}
  end

  test "a mesma auditoria fechada por dois processos conta uma vez", %{
    prefix: prefix,
    before: before
  } do
    page = running_page(prefix)

    results =
      concurrently([
        fn -> Audits.fail_task(page.id, :scan, :http_error, http_status: 403) end,
        fn -> Audits.fail_task(page.id, :scan, :timeout) end
      ])

    assert Enum.count(results, &match?({:ok, _}, &1)) == 1
    assert Enum.count(results, &match?({:error, :already_finished}, &1)) == 1

    expected = if Repo.get!(Audit, page.audit_id).error_http_status == 403, do: 1, else: 0
    assert delta(before) == %{audits_total: 1, audits_with_login_wall: expected}
  end
end
