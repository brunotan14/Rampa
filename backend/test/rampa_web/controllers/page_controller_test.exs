defmodule RampaWeb.PageControllerTest do
  @moduledoc """
  `GET /api/audits/:audit_id/pages` e `/pages/:id` (RF-RA006, RF-RA017). O formato é
  conferido contra a spec em `RampaWeb.ApiSpecTest`; aqui, o comportamento.
  """

  use RampaWeb.ConnCase, async: true

  import Rampa.AuditsFixtures

  alias RampaWeb.ApiSpec

  @passed [
    %{
      "rule_id" => "image-alt",
      "wcag_criteria" => ["1.1.1"],
      "help" => "Images must have alternative text",
      "nodes_total" => 1
    }
  ]

  setup do
    audit = audit_fixture()

    done =
      page_fixture(%{
        audit: audit,
        status: :done,
        title: "Início",
        passed_rules: @passed,
        inserted_at: ~U[2026-11-10 12:00:00Z]
      })

    failed =
      page_fixture(%{
        audit: audit,
        url: "https://exemplo.com/b",
        status: :failed,
        error: "http_error",
        inserted_at: ~U[2026-11-10 12:00:01Z]
      })

    finding_fixture(done, %{severity: :serious})
    finding_fixture(done, %{needs_review: true})

    %{audit: audit, done: done, failed: failed}
  end

  test "lista com contagens, erro pronto e passed_count", ctx do
    body = build_conn() |> get(~p"/api/audits/#{ctx.audit.id}/pages") |> json_response(200)

    assert [first, second] = body["data"]
    assert first["id"] == ctx.done.id
    assert first["title"] == "Início"

    assert first["counts_by_severity"] == %{
             "critical" => 0,
             "serious" => 1,
             "moderate" => 0,
             "minor" => 0
           }

    assert first["needs_review_count"] == 1
    assert first["passed_count"] == 1
    refute Map.has_key?(first, "passed_rules")

    assert second["error"]["code"] == "http_error"
    assert second["error"]["message"] =~ "erro HTTP"
    assert second["passed_count"] == nil
  end

  # Critério de aceite do RF-RA017 no backend: a lista de aprovadas sai com a regra.
  test "detalhe com as regras aprovadas; null quando não coletadas", ctx do
    body =
      build_conn()
      |> get(~p"/api/audits/#{ctx.audit.id}/pages/#{ctx.done.id}")
      |> json_response(200)

    assert body["passed_rules"] == [
             %{
               "rule_id" => "image-alt",
               "wcag_criteria" => ["1.1.1"],
               "help" => "Images must have alternative text",
               "nodes_total" => 1
             }
           ]

    assert body["axe_version"] == "4.14.0"

    failed =
      build_conn()
      |> get(~p"/api/audits/#{ctx.audit.id}/pages/#{ctx.failed.id}")
      |> json_response(200)

    assert failed["passed_rules"] == nil
  end

  test "página de outra auditoria é 404 page_not_found; auditoria inexistente, audit_not_found",
       ctx do
    other = page_fixture(%{status: :done})

    body =
      build_conn() |> get(~p"/api/audits/#{ctx.audit.id}/pages/#{other.id}") |> json_response(404)

    assert body["error"]["code"] == "page_not_found"

    body =
      build_conn() |> get(~p"/api/audits/#{ctx.audit.id}/pages/nao-e-uuid") |> json_response(404)

    assert body["error"]["code"] == "page_not_found"

    for path <- [
          ~p"/api/audits/#{Ecto.UUID.generate()}/pages",
          ~p"/api/audits/nao-e-uuid/pages",
          ~p"/api/audits/#{Ecto.UUID.generate()}/pages/#{ctx.done.id}"
        ] do
      assert build_conn() |> get(path) |> json_response(404) |> get_in(["error", "code"]) ==
               "audit_not_found"
    end
  end

  # RF-RA014: o link funciona sem login e sem cookie, e as respostas da API não vazam o
  # endereço para outros sites nem entram em buscadores.
  test "RF-RA014: sem sessão, com cabeçalhos de capacidade em sucesso e em erro", ctx do
    for path <- [
          ~p"/api/audits/#{ctx.audit.id}",
          ~p"/api/audits/#{ctx.audit.id}/pages",
          ~p"/api/audits/#{Ecto.UUID.generate()}/pages"
        ] do
      conn = build_conn() |> get(path)

      assert get_resp_header(conn, "referrer-policy") == ["no-referrer"]
      assert get_resp_header(conn, "x-robots-tag") == ["noindex, nofollow"]
      assert get_resp_header(conn, "cache-control") == ["no-store"]
      assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
      assert get_resp_header(conn, "set-cookie") == []
    end
  end

  # As respostas de erro fora de controller (rota inexistente, JSON malformado) saem pelo
  # `render_errors` do Phoenix: os cabeçalhos vêm do endpoint, não do pipeline do router.
  test "RF-RA014: cabeçalhos também nos erros fora de controller, e só em /api" do
    missing = build_conn() |> get("/api/nao-existe")
    assert json_response(missing, 404)["error"]["code"] == "not_found"

    # Exceção do `Plug.Parsers`: no teste, o Phoenix responde e relança.
    {400, malformed_headers, body} =
      assert_error_sent(400, fn ->
        build_conn()
        |> put_req_header("content-type", "application/json")
        |> post("/api/audits", "{nao e json")
      end)

    assert Jason.decode!(body)["error"]["code"] == "invalid_body"

    for headers <- [missing.resp_headers, malformed_headers] do
      assert {"cache-control", "no-store"} in headers
      assert {"x-robots-tag", "noindex, nofollow"} in headers
      assert {"referrer-policy", "no-referrer"} in headers
    end

    outside = build_conn() |> get("/robots.txt")
    assert get_resp_header(outside, "x-robots-tag") == []
  end

  test "UUID fora da forma canônica: page_id inválido e página 404", ctx do
    body =
      build_conn()
      |> get(~p"/api/audits/#{ctx.audit.id}/findings?page_id=aaaaaaaaaaaaaaaa")
      |> json_response(422)

    assert body["error"]["code"] == "invalid_filter"

    body =
      build_conn()
      |> get(~p"/api/audits/#{ctx.audit.id}/pages/abcdefghijklmnop")
      |> json_response(404)

    assert body["error"]["code"] == "page_not_found"

    body = build_conn() |> get(~p"/api/audits/abcdefghijklmnop/pages") |> json_response(404)
    assert body["error"]["code"] == "audit_not_found"
  end

  test "nodes_total que não é número: resumo e detalhe respondem 200", ctx do
    findings =
      for value <- ["12", true, %{"x" => 1}],
          do: finding_fixture(ctx.done, %{rule_id: "r", raw: %{"nodes_total" => value}})

    build_conn() |> get(~p"/api/audits/#{ctx.audit.id}") |> json_response(200)

    for finding <- findings do
      body =
        build_conn()
        |> get(~p"/api/audits/#{ctx.audit.id}/findings/#{finding.id}")
        |> json_response(200)

      assert body["nodes_total"] == nil
    end
  end

  test "RF-RA014: o id da auditoria é UUID v4 (aleatório, não sequencial)", ctx do
    <<_::48, version::4, _::12, variant::2, _::62>> = Ecto.UUID.dump!(ctx.audit.id)
    assert {version, variant} == {4, 2}
  end

  # RF-RA017 e "o Rampa não certifica conformidade": nenhum texto da API afirma que uma
  # página ou um site é acessível ou está conforme.
  test "nenhuma descrição da spec nem mensagem de erro afirma acessibilidade ou conformidade" do
    texts =
      [Jason.encode!(ApiSpec.spec())] ++
        Enum.map(
          Rampa.ErrorCodes.all(),
          &RampaWeb.ErrorMessages.message(&1, retry_at: DateTime.utc_now())
        )

    for text <- texts,
        phrase <- ["é acessível", "está conforme", "página acessível", "site acessível"] do
      refute String.contains?(String.downcase(text), phrase),
             "#{phrase} em #{String.slice(text, 0, 80)}"
    end
  end
end
