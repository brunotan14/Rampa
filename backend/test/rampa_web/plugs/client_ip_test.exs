defmodule RampaWeb.Plugs.ClientIPTest do
  # `async: false`: alguns testes mudam `:trusted_proxies` na configuração.
  use ExUnit.Case, async: false

  import Plug.Conn
  import Plug.Test

  alias Rampa.Security.{IPHash, TrustedProxies}
  alias RampaWeb.Plugs.ClientIP

  @traefik {172, 18, 0, 2}

  defp ranges(value) do
    {:ok, ranges} = TrustedProxies.parse(value)
    ranges
  end

  describe "client_ip/3" do
    test "sem proxy confiável, vale o IP da conexão e o X-Forwarded-For é ignorado" do
      assert ClientIP.client_ip({203, 0, 113, 9}, ["1.1.1.1"], []) == {203, 0, 113, 9}

      assert ClientIP.client_ip({203, 0, 113, 9}, ["1.1.1.1"], ranges("172.18.0.0/16")) ==
               {203, 0, 113, 9}
    end

    test "vindo do proxy confiável, lê da direita para a esquerda pulando os confiáveis" do
      trusted = ranges("172.18.0.0/16,10.0.0.0/8")

      # O cliente forjou "6.6.6.6"; o Traefik acrescentou o IP real à direita.
      assert ClientIP.client_ip(@traefik, ["6.6.6.6, 203.0.113.9"], trusted) == {203, 0, 113, 9}

      # Um proxy interno (10.0.0.3) entre o cliente e o Traefik é pulado.
      assert ClientIP.client_ip(@traefik, ["6.6.6.6, 203.0.113.9, 10.0.0.3"], trusted) ==
               {203, 0, 113, 9}

      # Cabeçalhos repetidos valem na ordem em que chegaram.
      assert ClientIP.client_ip(@traefik, ["6.6.6.6", "203.0.113.9"], trusted) ==
               {203, 0, 113, 9}
    end

    test "sem X-Forwarded-For ou só com IPs confiáveis, vale o confiável mais à esquerda" do
      trusted = ranges("172.18.0.0/16,10.0.0.0/8")

      assert ClientIP.client_ip(@traefik, [], trusted) == @traefik
      assert ClientIP.client_ip(@traefik, ["10.0.0.3"], trusted) == {10, 0, 0, 3}
    end

    test "item que não é IP para a leitura no último confiável" do
      trusted = ranges("172.18.0.0/16")

      assert ClientIP.client_ip(@traefik, ["203.0.113.9, lixo"], trusted) == @traefik
    end

    test "conexão IPv4 mapeada em IPv6 (Phoenix escutando em ::) casa com a faixa IPv4" do
      mapped = {0, 0, 0, 0, 0, 0xFFFF, 0xAC12, 0x0002}

      assert ClientIP.client_ip(mapped, ["203.0.113.9"], ranges("172.18.0.0/16")) ==
               {203, 0, 113, 9}
    end
  end

  describe "plug" do
    setup do
      on_exit(fn ->
        :ok = TrustedProxies.load(:test, Application.get_env(:rampa, :trusted_proxies))
      end)
    end

    defp call(remote_ip, forwarded_for) do
      conn(:post, "/api/audits")
      |> Map.put(:remote_ip, remote_ip)
      |> then(fn conn ->
        Enum.reduce(forwarded_for, conn, &put_req_header(&2, "x-forwarded-for", &1))
      end)
      |> ClientIP.call(ClientIP.init([]))
    end

    test "guarda só o hash, nunca o IP" do
      conn = call({203, 0, 113, 9}, [])

      assert conn.assigns.requester_ip_hash == IPHash.hash({203, 0, 113, 9})
      refute inspect(conn.assigns) =~ "203.0.113.9"
      assert Map.keys(conn.assigns) == [:requester_ip_hash]
    end

    test "conexão IPv4 mapeada em IPv6 tem o mesmo hash do IPv4" do
      assert call({0, 0, 0, 0, 0, 0xFFFF, 0xCB00, 0x7109}, []).assigns.requester_ip_hash ==
               IPHash.hash({203, 0, 113, 9})
    end

    test "X-Forwarded-For forjado de IP não confiável não muda o hash" do
      :ok = TrustedProxies.load(:test, "")

      assert call({203, 0, 113, 9}, ["1.1.1.1"]).assigns.requester_ip_hash ==
               call({203, 0, 113, 9}, ["8.8.8.8"]).assigns.requester_ip_hash
    end

    test "atrás do Traefik configurado, vale o cliente do X-Forwarded-For" do
      :ok = TrustedProxies.load(:test, "172.18.0.0/16")

      assert call(@traefik, ["203.0.113.9"]).assigns.requester_ip_hash ==
               IPHash.hash({203, 0, 113, 9})
    end
  end
end
