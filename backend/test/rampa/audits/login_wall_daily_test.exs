defmodule Rampa.Audits.LoginWallDailyTest do
  @moduledoc """
  RF-RA028, medição: quantas auditorias encerradas bateram numa barreira de login, por dia,
  sem dado pessoal. As auditorias passam pelo `ScanPageJob` com o scanner mockado.

  A linha do dia é compartilhada por todos os testes (e os de concorrência, fora do sandbox,
  gravam de verdade): por isso os testes comparam a medição antes e depois, nunca o valor
  absoluto do dia.
  """

  use Rampa.DataCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Mox
  import Rampa.AuditsFixtures

  alias Rampa.Audits.{LoginWallDaily, ScanPageJob}
  alias Rampa.Scanner.ClientMock
  alias Rampa.Security.ResolverMock

  setup :verify_on_exit!

  setup do
    stub(ResolverMock, :resolve, fn _host -> {:ok, [{93, 184, 215, 14}]} end)
    :ok
  end

  defp audit_through_job(url, response) do
    page = page_fixture(%{audit: audit_fixture(%{start_url: url}), url: url})
    expect(ClientMock, :scan, fn ^url -> response end)
    perform_job(ScanPageJob, %{"page_id" => page.id}, attempt: 1)
    page
  end

  defp redirected_to_login do
    scanner_response("limpa")
    |> Map.put("final_url", "https://exemplo.com/entrar")
    |> Map.put("login_wall", %{"password_field" => true})
  end

  defp delta(before, later) do
    %{
      audits_total: later.audits_total - before.audits_total,
      audits_with_login_wall: later.audits_with_login_wall - before.audits_with_login_wall
    }
  end

  @tag :capture_log
  test "RF-RA028: Dado auditorias com e sem barreira, quando consulto a medição, então vejo quantas tiveram barreira" do
    before = LoginWallDaily.summary(days: 1)

    # Com barreira: redirecionamento para tela com senha (concluída) e 401 (falha).
    audit_through_job("https://exemplo.com/painel", {:ok, redirected_to_login()})

    audit_through_job(
      "https://exemplo.com/restrito",
      {:error, %{code: :http_error, detail: "HTTP 401", http_status: 401}}
    )

    # Sem barreira: a limpa (concluída) e um 404 (falha).
    audit_through_job("https://exemplo.com/limpa.html", {:ok, scanner_response("limpa")})

    audit_through_job(
      "https://exemplo.com/sumiu",
      {:error, %{code: :http_error, detail: "HTTP 404", http_status: 404}}
    )

    later = LoginWallDaily.summary(days: 1)
    assert delta(before, later) == %{audits_total: 4, audits_with_login_wall: 2}

    # A mesma medição pela release (`bin/rampa eval`).
    assert Rampa.Release.login_wall_stats(days: 1) == later
  end

  @tag :capture_log
  test "auditoria ainda aberta não conta" do
    before = LoginWallDaily.summary(days: 1)
    page = page_fixture(%{url: "https://exemplo.com/painel"})

    expect(ClientMock, :scan, fn _url ->
      {:error, %{code: :http_error, detail: "HTTP 503", http_status: 503}}
    end)

    # 503 com tentativa sobrando: a auditoria continua aberta.
    assert {:error, :http_error} =
             perform_job(ScanPageJob, %{"page_id" => page.id}, attempt: 1)

    assert delta(before, LoginWallDaily.summary(days: 1)) ==
             %{audits_total: 0, audits_with_login_wall: 0}
  end

  test "o job repetido numa auditoria encerrada não conta de novo" do
    page = audit_through_job("https://exemplo.com/painel", {:ok, redirected_to_login()})
    before = LoginWallDaily.summary(days: 1)

    assert {:cancel, :already_finished} =
             perform_job(ScanPageJob, %{"page_id" => page.id}, attempt: 1)

    assert delta(before, LoginWallDaily.summary(days: 1)) ==
             %{audits_total: 0, audits_with_login_wall: 0}
  end

  test "o dia é o de São Paulo e o período respeita from e to" do
    # 02:00 UTC de 13/11 ainda é 12/11 em São Paulo (UTC-3).
    Repo.insert_all(LoginWallDaily, [
      %{day: ~D[2099-11-11], audits_total: 5, audits_with_login_wall: 1},
      %{day: ~D[2099-11-12], audits_total: 3, audits_with_login_wall: 2},
      %{day: ~D[2099-11-14], audits_total: 7, audits_with_login_wall: 0}
    ])

    assert %{
             from: ~D[2099-11-11],
             to: ~D[2099-11-12],
             audits_total: 8,
             audits_with_login_wall: 3,
             days: [%{day: ~D[2099-11-11]}, %{day: ~D[2099-11-12]}]
           } = LoginWallDaily.summary(days: 2, now: ~U[2099-11-13 02:00:00Z])

    assert %{audits_total: 10, days: [_, _]} =
             LoginWallDaily.summary(from: ~D[2099-11-12], to: ~D[2099-11-14])
  end

  test "a tabela não guarda URL, host, IP nem id de auditoria" do
    assert LoginWallDaily.__schema__(:fields) == [:day, :audits_total, :audits_with_login_wall]

    %{rows: columns} =
      Repo.query!(
        "SELECT column_name FROM information_schema.columns " <>
          "WHERE table_name = 'login_wall_daily' ORDER BY column_name"
      )

    assert List.flatten(columns) == ~w(audits_total audits_with_login_wall day)
  end

  test "o banco recusa mais auditorias com barreira que o total" do
    assert_raise Postgrex.Error, ~r/login_wall_counts_valid/, fn ->
      Repo.insert_all(LoginWallDaily, [
        %{day: ~D[2099-01-01], audits_total: 1, audits_with_login_wall: 2}
      ])
    end
  end
end
