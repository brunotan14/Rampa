defmodule Rampa.Scanner.ContractTest do
  use ExUnit.Case, async: true

  import Rampa.AuditsFixtures, only: [scanner_response: 1]

  alias Rampa.ErrorCodes
  alias Rampa.Scanner.Contract

  @schema Contract.path() |> File.read!() |> Jason.decode!()
  @fixtures Path.expand("../../support/fixtures/scanner", __DIR__)

  defp definition(name), do: get_in(@schema, ["definitions", name])

  describe "schema canônico" do
    test "é draft-07" do
      assert @schema["$schema"] == "http://json-schema.org/draft-07/schema#"
    end

    test "versão e códigos de erro vêm do schema" do
      assert Contract.version() == definition("ContractVersion")["const"]

      assert Enum.map(Contract.error_codes(), &Atom.to_string/1) ==
               definition("ScanErrorCode")["enum"]

      assert ErrorCodes.scanner() == Contract.error_codes()
    end
  end

  describe "fixtures do scanner usadas nos testes" do
    fixtures =
      @fixtures |> File.ls!() |> Enum.filter(&String.ends_with?(&1, ".json")) |> Enum.sort()

    assert fixtures != []

    for file <- fixtures do
      test "#{file} cumpre o contrato" do
        body = scanner_response(Path.rootname(unquote(file)))
        assert Contract.check_response(body) == :ok
      end
    end
  end

  describe "check_response/1" do
    for field <- get_in(@schema, ["definitions", "ScanResponse", "required"]),
        field != "contract_version" do
      test "sem #{field} é invalid_scan_result" do
        body = Map.delete(scanner_response("img-sem-alt"), unquote(field))

        assert {:error, %{code: :invalid_scan_result, detail: detail}} =
                 Contract.check_response(body)

        assert detail =~ "fora do contrato"
        assert detail =~ unquote(field)
      end
    end

    @tag :capture_log
    test "sem contract_version é contract_mismatch" do
      body = Map.delete(scanner_response("limpa"), "contract_version")

      assert Contract.check_response(body) ==
               {:error,
                %{
                  code: :contract_mismatch,
                  detail: ~s(versão do contrato do scanner: recebida nil, esperada "1")
                }}
    end

    @tag :capture_log
    test "outra versão é contract_mismatch, mesmo com o resto válido" do
      body = Map.put(scanner_response("limpa"), "contract_version", "2")
      assert {:error, %{code: :contract_mismatch}} = Contract.check_response(body)
    end

    test "campo desconhecido é recusado" do
      body = Map.put(scanner_response("limpa"), "extra", 1)
      assert {:error, %{code: :invalid_scan_result}} = Contract.check_response(body)
    end

    test "status de erro numa resposta de sucesso é recusado" do
      body = Map.put(scanner_response("limpa"), "http_status", 404)
      assert {:error, %{code: :invalid_scan_result}} = Contract.check_response(body)

      assert :ok =
               Contract.check_response(Map.put(scanner_response("limpa"), "http_status", nil))
    end

    test "título acima do limite é recusado" do
      max = get_in(@schema, ["definitions", "ScanResponse", "properties", "title", "maxLength"])
      ok = Map.put(scanner_response("limpa"), "title", String.duplicate("é", max))
      assert :ok = Contract.check_response(ok)

      long = Map.put(ok, "title", String.duplicate("é", max + 1))
      assert {:error, %{code: :invalid_scan_result}} = Contract.check_response(long)
    end

    test "mais nós por regra que o limite é recusado" do
      max = get_in(@schema, ["definitions", "AxeRule", "properties", "nodes", "maxItems"])

      body =
        update_in(scanner_response("img-sem-alt"), ["axe", "violations"], fn [rule] ->
          [%{rule | "nodes" => List.duplicate(hd(rule["nodes"]), max + 1)}]
        end)

      assert {:error, %{code: :invalid_scan_result, detail: detail}} =
               Contract.check_response(body)

      assert detail =~ "#/axe/violations/0/nodes"
    end

    test "HTML acima do limite é recusado" do
      max = get_in(@schema, ["definitions", "AxeNode", "properties", "html", "maxLength"])

      body =
        update_in(scanner_response("img-sem-alt"), ["axe", "violations"], fn [rule] ->
          [%{rule | "nodes" => [%{hd(rule["nodes"]) | "html" => String.duplicate("a", max + 1)}]}]
        end)

      assert {:error, %{code: :invalid_scan_result}} = Contract.check_response(body)
    end

    test "o detalhe lista no máximo três erros" do
      body =
        Map.merge(scanner_response("limpa"), %{
          "final_url" => "ftp://x",
          "title" => 1,
          "http_status" => 404,
          "blocked_requests" => -1
        })

      assert {:error, %{code: :invalid_scan_result, detail: detail}} =
               Contract.check_response(body)

      assert detail =~ "(e mais "
    end

    test "corpo que não é objeto é unavailable" do
      assert {:error, %{code: :unavailable}} = Contract.check_response("<html>")
      assert {:error, %{code: :unavailable}} = Contract.check_response([1])
    end
  end

  describe "scanner_error/2" do
    test "cada código do contrato é aceito, com o status do schema" do
      for code <- Contract.error_codes() do
        body = %{"contract_version" => "1", "error" => Atom.to_string(code), "detail" => "x"}
        assert Contract.scanner_error(422, body) == {:ok, %{code: code, detail: "x"}}
      end

      assert Map.keys(Contract.error_statuses()) |> Enum.sort() ==
               Enum.sort(Contract.error_codes())

      assert Contract.error_statuses() ==
               Map.new(definition("ScanErrorCode")["x-http-status"], fn {code, status} ->
                 {String.to_existing_atom(code), status}
               end)
    end

    @tag :capture_log
    test "código conhecido sem detail vira HTTP <status>" do
      body = %{"contract_version" => "1", "error" => "timeout"}
      assert Contract.scanner_error(504, body) == {:ok, %{code: :timeout, detail: "HTTP 504"}}
    end

    test "sem código reconhecível e sem versão é :unknown" do
      assert Contract.scanner_error(400, %{"error" => "Bad Request"}) == :unknown
      assert Contract.scanner_error(500, "erro") == :unknown
    end
  end
end
