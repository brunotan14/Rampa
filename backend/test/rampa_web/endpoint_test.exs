defmodule RampaWeb.EndpointTest do
  @moduledoc """
  Sockets do endpoint (RF-RA004): `/socket` só por websocket; o `/live` do LiveView só existe
  em dev (LiveDashboard), nunca em teste nem em produção.
  """

  use RampaWeb.ConnCase, async: true

  test "o /live do LiveView não existe fora de dev: cai no fallback da SPA", %{conn: conn} do
    for path <- ["/live/websocket", "/live/longpoll"] do
      conn = conn |> recycle() |> get(path)
      # O transporte do LiveView recusaria o pedido sem upgrade (400); aqui é o index.html.
      assert conn.status == 200
      assert conn.resp_body =~ "<div id=\"root\">"
    end
  end

  test "/socket não tem longpoll", %{conn: conn} do
    assert conn |> get("/socket/longpoll") |> json_response(404)
  end

  test "/socket/websocket é do socket do tempo real, não do router", %{conn: conn} do
    # Sem o pedido de upgrade, o transporte recusa; o router responderia 404.
    assert get(conn, "/socket/websocket").status == 400
  end
end
