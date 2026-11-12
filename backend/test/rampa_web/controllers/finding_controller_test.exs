defmodule RampaWeb.FindingControllerTest do
  use RampaWeb.ConnCase, async: true

  import Rampa.AuditsFixtures

  @fields ~w(id page_id source rule_id help wcag_criteria severity needs_review confidence
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

  test "campos da lista, sem raw, recorte nem campos de IA", %{conn: conn, audit_id: audit_id} do
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

  describe "GET /api/audits/:audit_id/findings/:id (RF-RA007)" do
    test "detalhe com IA, ocorrências e outras páginas; sem raw nem recorte", %{page: page} do
      finding = Rampa.Repo.get_by!(Rampa.Audits.Finding, page_id: page.id, source: :ai)

      body =
        build_conn()
        |> get(~p"/api/audits/#{page.audit_id}/findings/#{finding.id}")
        |> json_response(200)

      assert body["audit_id"] == page.audit_id
      assert body["confidence"] == 0.6
      assert body["ai_model"] == "claude-sonnet-5-5"
      assert body["axe_version"] == nil
      assert body["page"]["id"] == page.id
      assert body["occurrences"] == %{"page" => 1, "audit" => 1}
      assert body["other_pages"] == []
      refute Map.has_key?(body, "raw")
      refute Map.has_key?(body, "crop_path")
      refute inspect(body) =~ "segredo"
      refute inspect(body) =~ "recortes"
    end

    test "help_url só da documentação do axe", %{page: page} do
      for {url, expected} <- [
            {"https://dequeuniversity.com/rules/axe/4.14/image-alt?application=playwright",
             "https://dequeuniversity.com/rules/axe/4.14/image-alt?application=playwright"},
            {"javascript:alert(1)", nil},
            {"https://dequeuniversity.com.evil.example/x", nil},
            {"http://dequeuniversity.com/x", nil},
            {"https://dequeuniversity.com/x y", nil},
            {123, nil}
          ] do
        finding = finding_fixture(page, %{raw: %{"helpUrl" => url, "help" => "Ajuda"}})

        body =
          build_conn()
          |> get(~p"/api/audits/#{page.audit_id}/findings/#{finding.id}")
          |> json_response(200)

        assert body["help_url"] == expected, inspect(url)
        assert body["help"] == "Ajuda"
      end
    end

    test "achado de outra auditoria é 404 finding_not_found", %{audit_id: audit_id} do
      foreign = page_fixture(%{status: :done}) |> finding_fixture()

      body =
        build_conn()
        |> get(~p"/api/audits/#{audit_id}/findings/#{foreign.id}")
        |> json_response(404)

      assert body["error"]["code"] == "finding_not_found"

      body =
        build_conn()
        |> get(~p"/api/audits/#{Ecto.UUID.generate()}/findings/#{foreign.id}")
        |> json_response(404)

      assert body["error"]["code"] == "audit_not_found"
    end
  end

  test "filtros só da query string: o audit_id do caminho não vira filtro", %{
    conn: conn,
    audit_id: audit_id
  } do
    body = conn |> index(audit_id, %{sort: "severity", wcag: "1.1.1"}) |> json_response(200)
    assert body["total"] == 5
    assert hd(body["data"])["severity"] == "critical"

    body = build_conn() |> index(audit_id, %{sort: "x"}) |> json_response(422)
    assert body["error"]["code"] == "invalid_sort"
  end
end
