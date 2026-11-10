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
        blocked_address: 403,
        timeout: 504,
        http_error: 502,
        navigation_failed: 502
      ] do
    test "scan/1 traduz o erro #{code} do contrato" do
      code = unquote(code)
      status = unquote(status)

      stub(fn conn ->
        conn
        |> Plug.Conn.put_status(status)
        |> Req.Test.json(%{"error" => Atom.to_string(code), "detail" => "detalhe"})
      end)

      assert HTTP.scan("https://exemplo.com/") == {:error, %{code: code, detail: "detalhe"}}
    end
  end

  test "scan/1 devolve unavailable quando o scanner não responde" do
    stub(&Req.Test.transport_error(&1, :econnrefused))

    assert {:error, %{code: :unavailable}} = HTTP.scan("https://exemplo.com/")
  end

  test "scan/1 devolve unavailable para erro fora do contrato" do
    stub(fn conn ->
      conn |> Plug.Conn.put_status(500) |> Req.Test.json(%{"error" => "outra_coisa"})
    end)

    assert HTTP.scan("https://exemplo.com/") ==
             {:error, %{code: :unavailable, detail: "scanner respondeu HTTP 500"}}
  end

  test "scan/1 devolve unavailable para resposta 200 sem o campo axe" do
    stub(&Req.Test.json(&1, %{"title" => "x"}))

    assert {:error, %{code: :unavailable}} = HTTP.scan("https://exemplo.com/")
  end
end
