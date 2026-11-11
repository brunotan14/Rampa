defmodule RampaWeb.ApiSpecTest do
  @moduledoc """
  Teste de contrato: as respostas reais dos controllers, de sucesso e de erro, são
  conferidas contra a especificação OpenAPI (`RampaWeb.ApiSpec`). Se o código e a
  documentação divergirem (campo novo, status não documentado, código de erro fora do
  `enum`), este teste quebra.
  """

  use RampaWeb.ConnCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Ecto.Query
  import Mox
  import OpenApiSpex.TestAssertions
  import Rampa.AuditsFixtures

  alias Rampa.Audits.{Limits, Page, ScanPageJob}
  alias Rampa.Repo
  alias Rampa.Scanner.ClientMock
  alias Rampa.Security.{IPHash, ResolverMock}
  alias RampaWeb.{ApiSpec, ErrorMessages}

  setup :verify_on_exit!

  setup %{conn: conn} do
    ip = {192, 0, 2, :rand.uniform(254)}
    %{conn: %{conn | remote_ip: ip}, ip: ip, spec: ApiSpec.spec()}
  end

  defp stub_public_dns,
    do: stub(ResolverMock, :resolve, fn _host -> {:ok, [{93, 184, 215, 14}]} end)

  defp create(conn, body), do: post(conn, ~p"/api/audits", body)

  describe "a especificação" do
    test "é servida em /api/openapi.json com as quatro rotas", %{conn: conn} do
      spec = conn |> get("/api/openapi.json") |> json_response(200)

      assert spec["openapi"] =~ ~r/^3\./
      assert spec["info"]["title"] == "Rampa"

      assert Map.keys(spec["paths"]) |> Enum.sort() ==
               ~w(/api/audits /api/audits/{audit_id}/findings /api/audits/{id} /api/health)
    end

    test "documenta o Idempotency-Key, o Retry-After do 429 e o cursor", %{spec: spec} do
      post = spec.paths["/api/audits"].post

      assert Enum.any?(post.parameters, &(&1.name == :"Idempotency-Key" and &1.in == :header))
      assert %{"Retry-After" => _} = post.responses[429].headers

      list = spec.paths["/api/audits/{audit_id}/findings"].get
      assert Enum.any?(list.parameters, &(&1.name == :cursor and &1.in == :query))
    end

    test "todo código de erro documentado tem mensagem própria", %{spec: spec} do
      codes =
        for {_name, %{properties: %{error: %{properties: %{code: %{enum: enum}}}}}} <-
              spec.components.schemas,
            code <- enum,
            uniq: true,
            do: code

      assert "rate_limited" in codes and "blocked_address" in codes
      assert codes -- ErrorMessages.codes() == []
    end
  end

  describe "POST /api/audits" do
    test "202", %{conn: conn} do
      stub_public_dns()
      conn |> create(%{url: "https://exemplo.com/"}) |> assert_operation_response("createAudit")
    end

    test "400: sem url e JSON malformado", %{conn: conn, spec: spec} do
      conn |> create(%{}) |> assert_operation_response("createAudit")

      {400, _headers, body} =
        assert_error_sent(400, fn ->
          conn
          |> put_req_header("content-type", "application/json")
          |> post(~p"/api/audits", "{")
        end)

      assert_schema(Jason.decode!(body), "InvalidBodyError", spec)
    end

    test "422: esquema, endereço bloqueado, domínio inexistente, page_limit e chave",
         %{conn: conn} do
      expect(ResolverMock, :resolve, fn _host -> {:error, :nxdomain} end)

      for {body, headers} <- [
            {%{url: "ftp://exemplo.com"}, []},
            {%{url: "http://localhost:4000"}, []},
            {%{url: "https://nao-existe.exemplo.com/"}, []},
            {%{url: "https://user:x@exemplo.com/"}, []},
            {%{url: "https://exemplo.com/", page_limit: 30}, []},
            {%{url: "https://exemplo.com/"}, [{"idempotency-key", "com espaço"}]}
          ] do
        conn =
          headers
          |> Enum.reduce(conn, fn {name, value}, conn -> put_req_header(conn, name, value) end)
          |> create(body)

        assert conn.status == 422
        assert_operation_response(conn, "createAudit")
      end
    end

    test "429: limite por hora, com Retry-After", %{conn: conn, ip: ip} do
      stub_public_dns()
      for _ <- 1..5, do: audit_fixture(%{requester_ip_hash: IPHash.hash(ip)})

      conn = create(conn, %{url: "https://exemplo.com/"})

      assert conn.status == 429
      assert [_seconds] = get_resp_header(conn, "retry-after")
      assert_operation_response(conn, "createAudit")
    end

    test "429: teto diário", %{conn: conn} do
      stub_public_dns()
      for i <- 1..Limits.config().daily, do: audit_fixture(%{requester_ip_hash: "outro-#{i}"})

      conn = create(conn, %{url: "https://exemplo.com/"})

      assert %{"error" => %{"code" => "daily_limit_reached"}} = json_response(conn, 429)
      assert_operation_response(conn, "createAudit")
    end

    test "503: falha do DNS", %{conn: conn} do
      expect(ResolverMock, :resolve, fn _host -> {:error, :timeout} end)

      conn = create(conn, %{url: "https://exemplo.com/"})

      assert conn.status == 503
      assert_operation_response(conn, "createAudit")
    end
  end

  describe "GET /api/audits/:id" do
    test "200 recém-criada, 200 concluída com achados, 200 com erro, 404", %{conn: conn} do
      stub_public_dns()
      %{"id" => id} = conn |> create(%{url: "https://exemplo.com/"}) |> json_response(202)

      build_conn() |> get(~p"/api/audits/#{id}") |> assert_operation_response("getAudit")

      [page] = Repo.all(from p in Page, where: p.audit_id == ^id)
      expect(ClientMock, :scan, fn _url -> {:ok, scanner_response("img-sem-alt")} end)
      assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})

      build_conn() |> get(~p"/api/audits/#{id}") |> assert_operation_response("getAudit")

      failed = audit_fixture(%{status: :failed, error: "blocked_address", pages_failed: 1})
      build_conn() |> get(~p"/api/audits/#{failed.id}") |> assert_operation_response("getAudit")

      conn = build_conn() |> get(~p"/api/audits/nao-e-uuid")
      assert conn.status == 404
      assert_operation_response(conn, "getAudit")
    end
  end

  describe "GET /api/audits/:id/findings" do
    test "200 com achados do axe e de IA, com cursor; 404; 422", %{conn: conn} do
      page = page_fixture(%{status: :done})
      finding_fixture(page)
      finding_fixture(page, %{source: :ai, needs_review: true, confidence: 0.5})
      finding_fixture(page, %{selector: nil, html_snippet: nil, message: nil})

      conn
      |> get(~p"/api/audits/#{page.audit_id}/findings?limit=2")
      |> assert_operation_response("listFindings")

      empty = page_fixture(%{status: :done})

      build_conn()
      |> get(~p"/api/audits/#{empty.audit_id}/findings")
      |> assert_operation_response("listFindings")

      not_found = build_conn() |> get(~p"/api/audits/#{Ecto.UUID.generate()}/findings")
      assert not_found.status == 404
      assert_operation_response(not_found, "listFindings")

      for query <- ["severity=x", "limit=500", "cursor=x"] do
        invalid = build_conn() |> get("/api/audits/#{page.audit_id}/findings?#{query}")
        assert invalid.status == 422
        assert_operation_response(invalid, "listFindings")
      end
    end
  end

  describe "GET /api/health" do
    test "200 e 503", %{conn: conn} do
      expect(ClientMock, :health, fn -> :ok end)
      conn |> get(~p"/api/health") |> assert_operation_response("health")

      expect(ClientMock, :health, fn -> {:error, :econnrefused} end)

      ExUnit.CaptureLog.capture_log(fn ->
        conn = build_conn() |> get(~p"/api/health")
        assert conn.status == 503
        assert_operation_response(conn, "health")
      end)
    end
  end
end
