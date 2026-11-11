defmodule RampaWeb.FindingControllerTest do
  use RampaWeb.ConnCase, async: true

  import Rampa.AuditsFixtures

  @fields ~w(id page_id source rule_id wcag_criteria severity needs_review confidence
             selector html_snippet message)

  setup do
    page = page_fixture(%{status: :done})
    base = ~U[2026-11-10 12:00:00Z]

    for i <- 0..4 do
      finding_fixture(page, %{
        rule_id: "regra-#{i}",
        severity: Enum.at([:critical, :serious, :moderate, :minor, :critical], i),
        needs_review: i == 3,
        source: if(i == 3, do: :ai, else: :axe),
        confidence: if(i == 3, do: 0.6),
        ai_model: if(i == 3, do: "claude-sonnet-5-5"),
        inserted_at: DateTime.add(base, i),
        updated_at: base
      })
    end

    %{page: page, audit_id: page.audit_id}
  end

  defp index(conn, audit_id, params \\ %{}),
    do: get(conn, ~p"/api/audits/#{audit_id}/findings?#{params}")

  test "campos do M1, sem raw, recorte nem campos de IA", %{conn: conn, audit_id: audit_id} do
    body = conn |> index(audit_id) |> json_response(200)

    assert %{"data" => [first | _] = data, "next_cursor" => nil} = body
    assert length(data) == 5
    assert first |> Map.keys() |> Enum.sort() == Enum.sort(@fields)

    assert %{"rule_id" => "regra-0", "wcag_criteria" => ["1.1.1"], "severity" => "critical"} =
             first

    refute inspect(body) =~ "segredo"
    refute inspect(body) =~ "recortes"
    refute inspect(body) =~ "claude"
  end

  test "paginação com cursor", %{conn: conn, audit_id: audit_id} do
    first = conn |> index(audit_id, %{limit: 2}) |> json_response(200)
    assert %{"data" => [_, _], "next_cursor" => cursor} = first
    assert is_binary(cursor)

    second = conn |> index(audit_id, %{limit: 2, cursor: cursor}) |> json_response(200)
    assert %{"data" => [_, _], "next_cursor" => cursor} = second

    third = conn |> index(audit_id, %{limit: 2, cursor: cursor}) |> json_response(200)
    assert %{"data" => [_], "next_cursor" => nil} = third

    rules =
      Enum.flat_map([first, second, third], fn page -> Enum.map(page["data"], & &1["rule_id"]) end)

    assert rules == for(i <- 0..4, do: "regra-#{i}")
  end

  test "filtros", %{conn: conn, audit_id: audit_id} do
    assert %{"data" => data} =
             conn |> index(audit_id, %{severity: "critical"}) |> json_response(200)

    assert Enum.map(data, & &1["rule_id"]) == ["regra-0", "regra-4"]

    assert %{"data" => [%{"rule_id" => "regra-3"}]} =
             conn |> index(audit_id, %{source: "ai"}) |> json_response(200)

    assert %{"data" => [%{"rule_id" => "regra-3", "needs_review" => true, "confidence" => 0.6}]} =
             conn |> index(audit_id, %{needs_review: "true"}) |> json_response(200)

    assert %{"data" => data} =
             conn |> index(audit_id, %{needs_review: "false"}) |> json_response(200)

    assert length(data) == 4
  end

  test "valores inválidos: 422", %{conn: conn, audit_id: audit_id} do
    for {params, code} <- [
          {%{severity: "critico"}, "invalid_filter"},
          {%{source: "robo"}, "invalid_filter"},
          {%{needs_review: "sim"}, "invalid_filter"},
          {%{limit: 0}, "invalid_limit"},
          {%{limit: 101}, "invalid_limit"},
          {%{limit: "x"}, "invalid_limit"},
          {%{cursor: "nao-e-cursor"}, "invalid_cursor"},
          # Instante antes do mínimo do PostgreSQL: dava HTTP 500 (Postgrex 22008).
          {%{
             cursor:
               Base.url_encode64("-210866803200000001:#{Ecto.UUID.generate()}", padding: false)
           }, "invalid_cursor"}
        ] do
      assert %{"error" => %{"code" => ^code, "message" => message}} =
               conn |> index(audit_id, params) |> json_response(422)

      assert is_binary(message)
    end
  end

  test "auditoria inválida ou inexistente: 404", %{conn: conn} do
    missing = conn |> index(Ecto.UUID.generate()) |> json_response(404)
    invalid = conn |> index("nao-e-uuid") |> json_response(404)

    assert missing == invalid
    assert %{"error" => %{"code" => "audit_not_found"}} = missing
  end
end
