defmodule Rampa.Scanner.HTTPTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog
  import Rampa.AuditsFixtures, only: [scanner_response: 1]

  alias Rampa.Scanner.{Contract, HTTP}

  defp stub(fun), do: Req.Test.stub(HTTP, fun)

  defp error_stub(status, body) do
    stub(fn conn -> conn |> Plug.Conn.put_status(status) |> Req.Test.json(body) end)
  end

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

  # Cada código do contrato com o status HTTP do schema (`x-http-status`).
  for {code, status} <- Contract.error_statuses() do
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

  test "scan/1 descarta campos que a versão do contrato não conhece" do
    response = scanner_response("img-sem-alt")
    stub(&Req.Test.json(&1, put_in(response, ["axe", "passes"], [%{"id" => "x"}])))

    assert capture_log(fn -> assert HTTP.scan("https://exemplo.com/") == {:ok, response} end) =~
             "#/axe/passes"
  end

  describe "respostas fora do contrato" do
    test "200 sem um campo obrigatório é invalid_scan_result" do
      stub(&Req.Test.json(&1, Map.delete(scanner_response("limpa"), "axe")))

      assert {:error, %{code: :invalid_scan_result, detail: detail}} =
               HTTP.scan("https://exemplo.com/")

      assert detail =~ "axe"
    end

    @tag :capture_log
    test "200 sem contract_version (scanner antigo) é contract_mismatch" do
      stub(&Req.Test.json(&1, Map.delete(scanner_response("limpa"), "contract_version")))

      assert {:error, %{code: :contract_mismatch}} = HTTP.scan("https://exemplo.com/")
    end

    @tag :capture_log
    test "200 com outra versão do contrato é contract_mismatch" do
      stub(&Req.Test.json(&1, Map.put(scanner_response("limpa"), "contract_version", "2")))

      assert {:error, %{code: :contract_mismatch, detail: detail}} =
               HTTP.scan("https://exemplo.com/")

      assert detail =~ ~s(recebida "2")
    end

    test "200 que não é JSON é unavailable (passageiro)" do
      stub(&Plug.Conn.send_resp(&1, 200, "<html>ok</html>"))

      assert {:error, %{code: :unavailable}} = HTTP.scan("https://exemplo.com/")
    end

    test "200 com JSON que não é objeto é unavailable" do
      stub(&Req.Test.json(&1, [1, 2]))

      assert {:error, %{code: :unavailable}} = HTTP.scan("https://exemplo.com/")
    end

    test "contract_mismatch registra erro no log com as duas versões" do
      stub(&Req.Test.json(&1, Map.put(scanner_response("limpa"), "contract_version", "2")))

      log =
        capture_log([level: :error], fn ->
          assert {:error, %{code: :contract_mismatch}} = HTTP.scan("https://exemplo.com/")
        end)

      assert log =~ ~s(recebida "2")
      assert log =~ ~s(esperada "1")
    end
  end

  describe "erros do scanner: o código conhecido prevalece sobre a forma" do
    @tag :capture_log
    test "sem detail mantém o código, com o status como detalhe" do
      error_stub(502, %{"contract_version" => "1", "error" => "http_error"})

      assert HTTP.scan("https://exemplo.com/") ==
               {:error, %{code: :http_error, detail: "HTTP 502"}}
    end

    @tag :capture_log
    test "detail longo demais mantém o código, com o detalhe cortado" do
      error_stub(502, %{
        "contract_version" => "1",
        "error" => "navigation_failed",
        "detail" => String.duplicate("a", 5_000)
      })

      assert {:error, %{code: :navigation_failed, detail: detail}} =
               HTTP.scan("https://exemplo.com/")

      assert String.length(detail) == 2048
    end

    for code <- [:blocked_address, :invalid_url, :http_error, :resource_limit, :timeout] do
      @tag :capture_log
      test "#{code} sem versão ou com outra versão é respeitado" do
        code = unquote(code)

        for body <- [
              %{"error" => Atom.to_string(code), "detail" => "d"},
              %{"contract_version" => "9", "error" => Atom.to_string(code), "detail" => "d"}
            ] do
          error_stub(422, body)
          assert HTTP.scan("https://exemplo.com/") == {:error, %{code: code, detail: "d"}}
        end
      end
    end

    test "versão divergente num erro conhecido gera aviso no log" do
      error_stub(422, %{"error" => "blocked_address", "detail" => "d"})

      log =
        capture_log([level: :warning], fn ->
          assert {:error, %{code: :blocked_address}} = HTTP.scan("https://exemplo.com/")
        end)

      assert log =~ "versão do contrato"
    end

    @tag :capture_log
    test "código desconhecido com outra versão é contract_mismatch" do
      error_stub(502, %{"contract_version" => "2", "error" => "novo_codigo", "detail" => "d"})

      assert {:error, %{code: :contract_mismatch}} = HTTP.scan("https://exemplo.com/")
    end
  end
end
