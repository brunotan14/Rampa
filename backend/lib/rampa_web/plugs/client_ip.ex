defmodule RampaWeb.Plugs.ClientIP do
  @moduledoc """
  Descobre o IP de quem fez a requisição e guarda **só o hash** em
  `conn.assigns.requester_ip_hash` (RF-RA002). O IP puro não vai para `assigns`, para o
  banco nem para o log; `conn.remote_ip` continua sendo o da conexão.

    * Se `conn.remote_ip` está numa faixa de `TRUSTED_PROXIES` (o Traefik), o
      `X-Forwarded-For` é lido **da direita para a esquerda**, pulando os IPs confiáveis: o
      primeiro que não é confiável é o cliente. Quem chega pelo Traefik não consegue
      forjar a parte da direita, que o Traefik acrescenta;
    * se todos são confiáveis, vale o mais à esquerda; se um item não é IP, a leitura para
      e vale o último IP confiável lido;
    * se a conexão não vem de faixa confiável, o cabeçalho é ignorado e vale o IP da
      conexão.

  O cabeçalho `Forwarded` (RFC 7239) não é lido: o Traefik envia o `X-Forwarded-For`.
  """

  @behaviour Plug

  import Plug.Conn

  alias Rampa.Security.{IPHash, IPRanges, TrustedProxies}

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, _opts) do
    ip =
      client_ip(conn.remote_ip, get_req_header(conn, "x-forwarded-for"), TrustedProxies.ranges())

    assign(conn, :requester_ip_hash, IPHash.hash(ip))
  end

  @doc """
  IP do cliente a partir do IP da conexão, dos valores de `X-Forwarded-For` (na ordem em
  que chegaram) e das faixas confiáveis.
  """
  @spec client_ip(:inet.ip_address(), [String.t()], [TrustedProxies.range()]) ::
          :inet.ip_address()
  def client_ip(remote_ip, forwarded_for, ranges) do
    remote_ip = IPRanges.unmap(remote_ip)

    if TrustedProxies.trusted?(remote_ip, ranges) do
      forwarded_for
      |> Enum.flat_map(&String.split(&1, ","))
      |> Enum.map(&String.trim/1)
      |> Enum.reverse()
      |> walk(remote_ip, ranges)
    else
      remote_ip
    end
  end

  defp walk([], last_trusted, _ranges), do: last_trusted

  defp walk([entry | rest], last_trusted, ranges) do
    case IPRanges.parse(entry) do
      {:ok, ip} ->
        ip = IPRanges.unmap(ip)
        if TrustedProxies.trusted?(ip, ranges), do: walk(rest, ip, ranges), else: ip

      :error ->
        last_trusted
    end
  end
end
