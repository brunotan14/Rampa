defmodule Rampa.Scanner.HTTPTest do
  use ExUnit.Case, async: true

  import Rampa.AuditsFixtures, only: [scanner_response: 1]

  alias Rampa.Scanner.HTTP

  defp stub(fun), do: Req.Test.stub(HTTP, fun)

  test "scan/1 envia a URL em POST /scan e devolve o corpo" do
    response = scanner_response("img-sem-alt")

    stub(fn conn ->
      assert conn.method == "POST"
      assert conn.request_path == "/scan"
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      assert Jason.decode!(body) == %{"url" => "https://exemplo.com/"}
      Req.Test.json(conn, response)
    end)

    assert HTTP.scan("https://exemplo.com/") == {:ok, response}
  end

  for {code, status} <- [
        blocked_address: 422,
        invalid_url: 422,
        resource_limit: 422,
        timeout: 504,
        http_error: 502,
        navigation_failed: 502,
        analysis_failed: 502
      ] do
    test "scan/1 traduz o erro #{code} do contrato" do
      code = unquote(code)
      status = unquote(status)

      stub(fn conn ->
        conn
        |> Plug.Conn.put_status(status)
        |> Req.Test.json(%{
          "contract_version" => "1",
          "error" => Atom.to_string(code),
          "detail" => "detalhe"
        })
      end)

      assert HTTP.scan("https://exemplo.com/") == {:error, %{code: code, detail: "detalhe"}}
    end
  end

  test "scan/1 devolve unavailable quando o scanner não responde" do
    stub(&Req.Test.transport_error(&1, :econnrefused))

    assert {:error, %{code: :unavailable}} = HTTP.scan("https://exemplo.com/")
  end

  test "scan/1 devolve invalid_request quando o scanner recusa o pedido (4xx)" do
    # Formato real do erro de validação do Fastify
    stub(fn conn ->
      conn
      |> Plug.Conn.put_status(400)
      |> Req.Test.json(%{
        "statusCode" => 400,
        "code" => "FST_ERR_VALIDATION",
        "error" => "Bad Request",
        "message" => "body/url must match pattern"
      })
    end)

    assert HTTP.scan("https://exemplo.com/") ==
             {:error, %{code: :invalid_request, detail: "scanner recusou o pedido: HTTP 400"}}
  end

  test "scan/1 devolve unavailable para 5xx fora do contrato" do
    stub(fn conn ->
      conn |> Plug.Conn.put_status(500) |> Req.Test.json(%{"error" => "outra_coisa"})
    end)

    assert HTTP.scan("https://exemplo.com/") ==
             {:error, %{code: :unavailable, detail: "scanner respondeu HTTP 500"}}
  end

  describe "respostas fora do contrato" do
    test "200 sem um campo obrigatório é invalid_scan_result" do
      stub(&Req.Test.json(&1, Map.delete(scanner_response("limpa"), "axe")))

      assert {:error, %{code: :invalid_scan_result, detail: detail}} =
               HTTP.scan("https://exemplo.com/")

      assert detail =~ "axe"
    end

    test "200 sem contract_version (scanner antigo) é contract_mismatch" do
      stub(&Req.Test.json(&1, Map.delete(scanner_response("limpa"), "contract_version")))

      assert {:error, %{code: :contract_mismatch}} = HTTP.scan("https://exemplo.com/")
    end

    test "200 com outra versão do contrato é contract_mismatch" do
      stub(&Req.Test.json(&1, Map.put(scanner_response("limpa"), "contract_version", "2")))

      assert {:error, %{code: :contract_mismatch, detail: detail}} =
               HTTP.scan("https://exemplo.com/")

      assert detail =~ ~s(recebida "2")
    end

    test "200 que não é JSON é invalid_scan_result" do
      stub(&Plug.Conn.send_resp(&1, 200, "<html>ok</html>"))

      assert {:error, %{code: :invalid_scan_result}} = HTTP.scan("https://exemplo.com/")
    end

    test "erro do contrato sem versão é contract_mismatch" do
      stub(fn conn ->
        conn
        |> Plug.Conn.put_status(504)
        |> Req.Test.json(%{"error" => "timeout", "detail" => "detalhe"})
      end)

      assert {:error, %{code: :contract_mismatch}} = HTTP.scan("https://exemplo.com/")
    end

    test "erro do contrato sem detail é invalid_scan_result" do
      stub(fn conn ->
        conn
        |> Plug.Conn.put_status(502)
        |> Req.Test.json(%{"contract_version" => "1", "error" => "http_error"})
      end)

      assert {:error, %{code: :invalid_scan_result}} = HTTP.scan("https://exemplo.com/")
    end
  end
end
