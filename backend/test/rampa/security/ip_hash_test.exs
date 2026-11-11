defmodule Rampa.Security.IPHashTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Rampa.Security.IPHash

  @secret "segredo-de-teste-com-mais-de-32-caracteres"

  describe "hash/2" do
    test "HMAC-SHA256 em hexadecimal, sem o IP em claro" do
      hash = IPHash.hash({203, 0, 113, 9}, @secret)

      assert hash =~ ~r/\A[0-9a-f]{64}\z/

      assert hash ==
               :crypto.mac(:hmac, :sha256, @secret, "203.0.113.9") |> Base.encode16(case: :lower)

      refute hash =~ "203"
    end

    test "o segredo muda o hash" do
      refute IPHash.hash({1, 2, 3, 4}, @secret) == IPHash.hash({1, 2, 3, 4}, @secret <> "x")
    end

    test "IPv4 mapeado em IPv6 tem o mesmo hash do IPv4" do
      assert IPHash.hash({0, 0, 0, 0, 0, 0xFFFF, 0x0102, 0x0304}, @secret) ==
               IPHash.hash({1, 2, 3, 4}, @secret)
    end

    test "IPv6 conta pelo prefixo /64" do
      a = IPHash.hash({0x2001, 0xDB8, 1, 2, 0, 0, 0, 1}, @secret)
      b = IPHash.hash({0x2001, 0xDB8, 1, 2, 0xFFFF, 0xAB, 0xCD, 0xEF}, @secret)
      c = IPHash.hash({0x2001, 0xDB8, 1, 3, 0, 0, 0, 1}, @secret)

      assert a == b
      refute a == c
    end

    test "sem segredo informado, usa o da configuração" do
      assert IPHash.hash({1, 2, 3, 4}) == IPHash.hash({1, 2, 3, 4}, IPHash.secret())
    end
  end

  describe "check_startup/2 (RF-RA002)" do
    test "em produção, sem IP_HASH_SECRET, recusa subir e explica o motivo" do
      for secret <- [nil, ""] do
        log =
          capture_log(fn ->
            assert {:error, reason} = IPHash.check_startup(:prod, secret)
            assert reason =~ "IP_HASH_SECRET não está definida"
          end)

        assert log =~ "[error]"
        assert log =~ "IP_HASH_SECRET"
      end
    end

    test "em produção, segredo curto também não sobe" do
      capture_log(fn ->
        assert {:error, reason} = IPHash.check_startup(:prod, "curto")
        assert reason =~ "menos de 32"
      end)
    end

    test "com segredo, sobe" do
      assert :ok = IPHash.check_startup(:prod, @secret)
      assert :ok = IPHash.check_startup(:dev, "valor-fixo")
    end

    test "dev e test têm valor fixo na configuração" do
      assert is_binary(IPHash.secret()) and IPHash.secret() != ""
    end
  end
end
