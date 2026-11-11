defmodule Rampa.Security.TrustedProxiesTest do
  # `async: false`: `load/2` troca as faixas guardadas para o app inteiro.
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias Rampa.Security.{IPRanges, TrustedProxies}

  # Volta às faixas da configuração de teste.
  setup do
    on_exit(fn ->
      :ok = TrustedProxies.load(:test, Application.get_env(:rampa, :trusted_proxies))
    end)
  end

  describe "parse/1" do
    test "vazia por padrão" do
      assert TrustedProxies.parse("") == {:ok, []}
      assert TrustedProxies.parse(nil) == {:ok, []}
      assert TrustedProxies.parse(" , ") == {:ok, []}
    end

    test "faixas CIDR e IPs soltos, IPv4 e IPv6" do
      assert {:ok,
              [{{172, 18, 0, 0}, 16}, {{10, 0, 0, 7}, 32}, {{0xFD00, 0, 0, 0, 0, 0, 0, 0}, 8}]} =
               TrustedProxies.parse(" 172.18.0.0/16, 10.0.0.7 ,fd00::/8")
    end

    test "devolve as entradas inválidas" do
      assert {:error, ["traefik", "10.0.0.0/33", "1.2.3.4/x"]} =
               TrustedProxies.parse("traefik, 10.0.0.0/33, 1.2.3.4/x, 10.0.0.1")
    end
  end

  describe "trusted?/2" do
    setup do
      {:ok, ranges} = TrustedProxies.parse("172.18.0.0/16,fd00::/8")
      %{ranges: ranges}
    end

    test "casa pela faixa", %{ranges: ranges} do
      assert TrustedProxies.trusted?({172, 18, 3, 4}, ranges)
      refute TrustedProxies.trusted?({172, 19, 0, 1}, ranges)
      assert TrustedProxies.trusted?({0xFD00, 0, 0, 0, 0, 0, 0, 1}, ranges)
      refute TrustedProxies.trusted?({0xFE80, 0, 0, 0, 0, 0, 0, 1}, ranges)
    end

    test "lista vazia não confia em ninguém" do
      refute TrustedProxies.trusted?({127, 0, 0, 1}, [])
    end

    test "/0 casa com toda a família" do
      assert IPRanges.in_cidr?({8, 8, 8, 8}, {{0, 0, 0, 0}, 0})
      refute IPRanges.in_cidr?({0, 0, 0, 0, 0, 0, 0, 1}, {{0, 0, 0, 0}, 0})
    end
  end

  describe "load/2" do
    test "valor inválido não sobe, em qualquer ambiente" do
      for env <- [:prod, :dev] do
        capture_log(fn ->
          assert {:error, reason} = TrustedProxies.load(env, "traefik")
          assert reason =~ "TRUSTED_PROXIES"
          assert reason =~ "traefik"
        end)
      end
    end

    test "vazia em produção sobe com aviso no log" do
      log =
        capture_log([level: :warning], fn ->
          assert :ok = TrustedProxies.load(:prod, "")
        end)

      assert log =~ "TRUSTED_PROXIES está vazia em produção"
    end

    test "preenchida sobe sem aviso" do
      # Só o log deste módulo: o `capture_log` também pega o de outros testes assíncronos.
      log =
        capture_log(fn -> assert :ok = TrustedProxies.load(:prod, "172.18.0.0/16") end)

      refute log =~ "TRUSTED_PROXIES"

      assert :ok = TrustedProxies.load(:dev, "")
    end

    test "interpreta uma vez e guarda: ranges/0 devolve o que foi carregado" do
      assert :ok = TrustedProxies.load(:test, "172.18.0.0/16")
      assert TrustedProxies.ranges() == [{{172, 18, 0, 0}, 16}]
    end

    test "valor inválido não troca as faixas guardadas" do
      assert :ok = TrustedProxies.load(:test, "10.0.0.0/8")

      capture_log(fn -> assert {:error, _reason} = TrustedProxies.load(:test, "lixo") end)

      assert TrustedProxies.ranges() == [{{10, 0, 0, 0}, 8}]
    end
  end
end
