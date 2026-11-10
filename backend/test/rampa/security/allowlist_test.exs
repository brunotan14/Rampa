defmodule Rampa.Security.AllowlistTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Rampa.Security.Allowlist

  describe "parse/1" do
    test "vazia por padrão" do
      assert Allowlist.parse("") == []
      assert Allowlist.parse(nil) == []
      assert Allowlist.parse(" , ,") == []
    end

    test "separa por vírgula, normaliza e remove repetidos" do
      assert Allowlist.parse(" fixtures, Fixtures. ,outro.test") == ["fixtures", "outro.test"]
    end

    test "tira os colchetes do IPv6, como o scanner" do
      assert Allowlist.parse("[::1], FD00::1") == ["::1", "fd00::1"]
    end

    test "aceita lista" do
      assert Allowlist.parse(["fixtures", "OUTRO"]) == ["fixtures", "outro"]
    end
  end

  describe "check_startup/2 (RF-RA002)" do
    test "em produção, com a lista preenchida, recusa subir e registra o motivo" do
      log =
        capture_log(fn ->
          assert {:error, reason} = Allowlist.check_startup(:prod, ["fixtures"])
          assert reason =~ "SSRF_ALLOWLIST"
          assert reason =~ "fixtures"
        end)

      assert log =~ "[error]"
      assert log =~ "SSRF_ALLOWLIST está preenchida em produção"
    end

    test "em produção, com a lista vazia, sobe" do
      assert Allowlist.check_startup(:prod, []) == :ok
    end

    test "fora de produção sobe e avisa no log" do
      log =
        capture_log([level: :warning], fn ->
          assert :ok = Allowlist.check_startup(:test, ["fixtures"])
        end)

      assert log =~ "SSRF_ALLOWLIST preenchida: fixtures"

      assert :ok = Allowlist.check_startup(:dev, [])
    end
  end

  test "a configuração de teste não libera nenhum host" do
    assert Allowlist.hosts() == []
  end
end
