defmodule RampaWeb.SpaControllerTest do
  @moduledoc """
  O app serve o build do frontend (PRD §7, Hospedagem e deploy; RNF-RA008): arquivos com hash
  em cache longo, fallback da SPA com o `index.html` e a CSP, e `/api/*` sem rota ainda 404 em
  JSON. Usa o build de teste de `test/support/static` (`config :rampa, :static_from`).
  """

  use RampaWeb.ConnCase, async: true

  alias RampaWeb.Plugs.{ApiHeaders, BrowserHeaders}

  @index_marker "Rampa (build de teste)"

  defp assert_index(conn) do
    assert conn.status == 200
    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ ~r{^text/html}
    assert conn.resp_body =~ @index_marker

    for {name, value} <- BrowserHeaders.headers() do
      assert get_resp_header(conn, name) == [value], "cabeçalho #{name}"
    end

    conn
  end

  describe "fallback da SPA" do
    test "a raiz e as rotas do React Router devolvem o index.html", %{conn: conn} do
      for path <- [
            "/",
            "/auditorias/0b0e7a9e-4a52-4c39-9a8f-3a3f7bb3c0de",
            "/auditorias/0b0e7a9e-4a52-4c39-9a8f-3a3f7bb3c0de/paginas",
            "/qualquer/coisa?com=query",
            "/index.html"
          ] do
        conn |> recycle() |> get(path) |> assert_index()
      end
    end

    test "HEAD também responde com o index.html", %{conn: conn} do
      conn = head(conn, "/auditorias/x")
      assert conn.status == 200
      assert get_resp_header(conn, "cache-control") == ["no-cache"]
    end

    test "a CSP não libera inline, eval nem outras origens", %{conn: conn} do
      [csp] = conn |> get("/") |> get_resp_header("content-security-policy")

      refute csp =~ "unsafe-inline"
      refute csp =~ "unsafe-eval"
      refute csp =~ "*"
      refute csp =~ "http"
      assert csp =~ "default-src 'none'"
      assert csp =~ "script-src 'self'"
      assert csp =~ "connect-src 'self'"
      assert csp =~ "frame-ancestors 'none'"
    end

    test "o index.html não fica em cache (aponta para os arquivos do build atual)", %{conn: conn} do
      assert conn |> get("/") |> get_resp_header("cache-control") == ["no-cache"]
    end

    test "revalidação com o ETag: 304 sem corpo, com a CSP e o no-cache", %{conn: conn} do
      [etag] = conn |> get("/") |> get_resp_header("etag")
      assert etag =~ ~r/^"[A-Za-z0-9_-]{27}"$/

      for value <- [etag, "W/#{etag}", ~s("outro", #{etag}), "*"] do
        conn = conn |> recycle() |> put_req_header("if-none-match", value) |> get("/auditorias/x")

        assert conn.status == 304, value
        assert conn.resp_body == ""
        assert get_resp_header(conn, "etag") == [etag]

        for {name, header} <- BrowserHeaders.headers() do
          assert get_resp_header(conn, name) == [header], "#{value}: cabeçalho #{name}"
        end
      end

      conn = conn |> recycle() |> put_req_header("if-none-match", ~s("build-antigo")) |> get("/")
      assert_index(conn)
    end

    test "/api/* sem rota continua 404 em JSON, com os cabeçalhos da API e sem o HTML",
         %{conn: conn} do
      for path <- ["/api/inexistente", "/api", "/api/audits/x/y/z"] do
        conn = conn |> recycle() |> get(path)

        assert %{"error" => %{"code" => "not_found", "message" => message}} =
                 json_response(conn, 404)

        assert is_binary(message)
        refute conn.resp_body =~ @index_marker
        assert get_resp_header(conn, "content-security-policy") == []

        for {name, value} <- ApiHeaders.headers() do
          assert get_resp_header(conn, name) == [value], "#{path}: cabeçalho #{name}"
        end
      end
    end

    test "/socket/* sem rota é 404 em JSON, não o HTML", %{conn: conn} do
      for path <- ["/socket", "/socket/longpoll", "/socket/qualquer"] do
        conn = conn |> recycle() |> get(path)
        assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
      end
    end

    test "só GET: outro método fora da API é 404 em JSON", %{conn: conn} do
      for method <- [:post, :put, :delete] do
        conn = conn |> recycle() |> dispatch(@endpoint, method, "/auditorias/x")
        assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
      end
    end
  end

  describe "arquivos do build" do
    test "os de assets/ têm cache de um ano (o nome tem o hash do conteúdo)", %{conn: conn} do
      conn = get(conn, "/assets/index-teste123.js")

      assert conn.status == 200
      assert conn.resp_body =~ "build de teste"
      assert get_resp_header(conn, "cache-control") == ["public, max-age=31536000, immutable"]
      assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
      assert [content_type] = get_resp_header(conn, "content-type")
      assert content_type =~ "javascript"
    end

    test "a 304 dos arquivos do build mantém o cache e o nosniff", %{conn: conn} do
      for {path, cache} <- [
            {"/assets/index-teste123.js", "public, max-age=31536000, immutable"},
            {"/favicon.svg", "public, max-age=0, must-revalidate"}
          ] do
        [etag] = conn |> recycle() |> get(path) |> get_resp_header("etag")
        conn = conn |> recycle() |> put_req_header("if-none-match", etag) |> get(path)

        assert conn.status == 304, path
        assert get_resp_header(conn, "cache-control") == [cache], path
        assert get_resp_header(conn, "x-content-type-options") == ["nosniff"], path
      end
    end

    test "o favicon (nome fixo) é revalidado", %{conn: conn} do
      conn = get(conn, "/favicon.svg")

      assert conn.status == 200
      assert get_resp_header(conn, "cache-control") == ["public, max-age=0, must-revalidate"]
    end

    test "arquivo de assets/ que não existe é 404, nunca o index.html", %{conn: conn} do
      conn = get(conn, "/assets/nao-existe-abc.js")

      assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
      refute conn.resp_body =~ @index_marker
    end

    test "nada fora do build é servido como arquivo (o resto cai no index.html)", %{conn: conn} do
      for path <- ["/../mix.exs", "/robots.txt", "/favicon.ico"] do
        conn |> recycle() |> get(path) |> assert_index()
      end
    end
  end
end
