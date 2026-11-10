defmodule RampaWeb.HealthControllerTest do
  use RampaWeb.ConnCase, async: true

  import Mox

  setup :verify_on_exit!

  test "responde 200 quando app, banco e scanner estão de pé", %{conn: conn} do
    expect(Rampa.Scanner.ClientMock, :health, fn -> :ok end)

    conn = get(conn, ~p"/api/health")

    assert json_response(conn, 200) == %{
             "status" => "ok",
             "checks" => %{"app" => "ok", "database" => "ok", "scanner" => "ok"}
           }
  end

  @tag :capture_log
  test "responde 503 e aponta o scanner quando ele não responde", %{conn: conn} do
    expect(Rampa.Scanner.ClientMock, :health, fn -> {:error, :econnrefused} end)

    conn = get(conn, ~p"/api/health")

    assert %{"status" => "error", "checks" => %{"scanner" => "error", "database" => "ok"}} =
             json_response(conn, 503)
  end
end
