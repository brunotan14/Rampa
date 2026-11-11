defmodule Rampa.Security.TrustedProxies do
  @moduledoc """
  `TRUSTED_PROXIES` (RF-RA002): faixas CIDR (ou IPs soltos) separadas por vírgula, vazia por
  padrão. Só uma conexão vinda dessas faixas (o Traefik) tem o `X-Forwarded-For`
  considerado; fora delas vale o IP da conexão (`RampaWeb.Plugs.ClientIP`).

  O valor chega cru de `config/runtime.exs` (`:trusted_proxies`). `check_startup/2`, chamada
  em `Rampa.Application.start/2`, recusa valor inválido em qualquer ambiente e, em produção,
  avisa no log se a lista estiver vazia: atrás do Traefik, todo mundo teria o IP dele e
  dividiria o mesmo limite de taxa.
  """

  require Logger

  alias Rampa.Security.IPRanges

  @type range :: {:inet.ip_address(), non_neg_integer()}

  @doc "Interpreta o valor da variável. Devolve as entradas inválidas no erro."
  @spec parse(String.t() | nil) :: {:ok, [range()]} | {:error, [String.t()]}
  def parse(nil), do: {:ok, []}

  def parse(value) when is_binary(value) do
    entries =
      value
      |> String.split(",")
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.map(&{&1, IPRanges.parse_cidr(&1)})

    case for({entry, :error} <- entries, do: entry) do
      [] -> {:ok, Enum.map(entries, fn {_entry, {:ok, range}} -> range end)}
      invalid -> {:error, invalid}
    end
  end

  @doc """
  Faixas da configuração atual. O valor já foi conferido na subida; se ainda assim for
  inválido, nenhuma faixa é confiável.
  """
  @spec ranges() :: [range()]
  def ranges do
    case parse(Application.get_env(:rampa, :trusted_proxies)) do
      {:ok, ranges} -> ranges
      {:error, _invalid} -> []
    end
  end

  @doc "Diz se o IP está numa das faixas."
  @spec trusted?(:inet.ip_address(), [range()]) :: boolean()
  def trusted?(ip, ranges) do
    ip = IPRanges.unmap(ip)
    Enum.any?(ranges, &IPRanges.in_cidr?(ip, &1))
  end

  @doc """
  Confere a variável na subida do app: valor inválido impede a subida (`{:error, motivo}`);
  lista vazia em `:prod` só avisa no log.
  """
  @spec check_startup(atom(), String.t() | nil) :: :ok | {:error, String.t()}
  def check_startup(env, value) do
    case parse(value) do
      {:error, invalid} ->
        reason =
          "TRUSTED_PROXIES tem entradas inválidas (#{Enum.join(invalid, ", ")}). " <>
            "Use faixas CIDR ou IPs separados por vírgula, como 172.18.0.0/16."

        Logger.error(reason)
        {:error, reason}

      {:ok, []} when env == :prod ->
        Logger.warning(
          "TRUSTED_PROXIES está vazia em produção. Atrás do Traefik, todas as requisições " <>
            "chegam com o IP dele e dividem o mesmo limite de taxa. Defina a faixa da rede " <>
            "do Traefik."
        )

        :ok

      {:ok, _ranges} ->
        :ok
    end
  end
end
