defmodule RampaWeb.WcagControllerTest do
  use RampaWeb.ConnCase, async: true

  import OpenApiSpex.TestAssertions

  alias RampaWeb.Plugs.ApiHeaders

  test "FR-014: GET /api/wcag/criteria responde o catálogo, segundo o OpenAPI", %{conn: conn} do
    conn = get(conn, ~p"/api/wcag/criteria")

    assert conn.status == 200
    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ ~r{^application/json}
    assert_operation_response(conn, "listWcagCriteria")

    body = json_response(conn, 200)
    assert body["content_version"] == Rampa.Wcag.content_version()
    assert length(body["data"]) == length(Rampa.Wcag.all())
    assert Enum.map(body["data"], & &1["id"]) == Enum.map(Rampa.Wcag.all(), & &1.id)

    assert %{"id" => "1.1.1", "level" => "A", "emag" => [%{"id" => "3.6"} | _]} =
             hd(body["data"])

    assert %{"wcag" => %{"license" => _}, "emag" => %{"url" => _}} = body["sources"]
  end

  test "FR-014: o corpo é o pré-codificado na compilação, igual a cada requisição", %{conn: conn} do
    first = get(conn, ~p"/api/wcag/criteria")
    second = get(build_conn(), ~p"/api/wcag/criteria?extra=1")

    assert first.resp_body == Rampa.Wcag.body()
    assert second.resp_body == first.resp_body
  end

  test "FR-014 (RF-RA014): cabeçalhos da /api, sem sessão", %{conn: conn} do
    conn = get(conn, ~p"/api/wcag/criteria")

    for {name, value} <- ApiHeaders.headers() do
      assert get_resp_header(conn, name) == [value], name
    end

    assert get_resp_header(conn, "set-cookie") == []
  end

  test "FR-014: só GET; outro método é a rota inexistente da API", %{conn: conn} do
    conn = post(conn, ~p"/api/wcag/criteria", %{})
    assert json_response(conn, 404)["error"]["code"] == "not_found"
  end
end
