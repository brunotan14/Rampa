defmodule Rampa.Security.TrustedProxies do
  @moduledoc """
  `TRUSTED_PROXIES` (RF-RA002): faixas CIDR (ou IPs soltos) separadas por vírgula, vazia por
  padrão. Só uma conexão vinda dessas faixas (o Traefik) tem o `X-Forwarded-For`
  considerado; fora delas vale o IP da conexão (`RampaWeb.Plugs.ClientIP`).

  O valor chega cru de `config/runtime.exs` (`:trusted_proxies`) e é interpretado **uma vez
  só**, na subida: `load/2`, chamada em `Rampa.Application.start/2`, recusa valor inválido
  em qualquer ambiente (o app não sobe), avisa no log se a lista estiver vazia em produção
  (atrás do Traefik, todo mundo teria o IP dele e dividiria o mesmo limite de taxa) e guarda
  as faixas em `:persistent_term`. `ranges/0` só lê o que foi guardado; sem `load/2`, ela
  levanta erro em vez de cair numa lista vazia em silêncio.
  """

  require Logger

  alias Rampa.Security.IPRanges

  @type range :: {:inet.ip_address(), non_neg_integer()}

  @key {__MODULE__, :ranges}

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
  Faixas carregadas na subida por `load/2`. Levanta `ArgumentError` se nada foi carregado.
  """
  @spec ranges() :: [range()]
  def ranges, do: :persistent_term.get(@key)

  @doc """
  Diz se o IP está numa das faixas. O IP chega já normalizado (IPv4 mapeado em IPv6 vira
  IPv4 em `RampaWeb.Plugs.ClientIP`).
  """
  @spec trusted?(:inet.ip_address(), [range()]) :: boolean()
  def trusted?(ip, ranges), do: Enum.any?(ranges, &IPRanges.in_cidr?(ip, &1))

  @doc """
  Interpreta o valor da variável na subida do app e guarda as faixas. Valor inválido
  devolve `{:error, motivo}` (registrado no log) e não troca o que estava guardado; lista
  vazia em `:prod` sobe com um aviso no log.
  """
  @spec load(atom(), String.t() | nil) :: :ok | {:error, String.t()}
  def load(env, value) do
    case parse(value) do
      {:error, invalid} ->
        reason =
          "TRUSTED_PROXIES tem entradas inválidas (#{Enum.join(invalid, ", ")}). " <>
            "Use faixas CIDR ou IPs separados por vírgula, como 172.18.0.0/16."

        Logger.error(reason)
        {:error, reason}

      {:ok, ranges} ->
        if ranges == [] and env == :prod do
          Logger.warning(
            "TRUSTED_PROXIES está vazia em produção. Atrás do Traefik, todas as requisições " <>
              "chegam com o IP dele e dividem o mesmo limite de taxa. Defina a faixa da rede " <>
              "do Traefik."
          )
        end

        :persistent_term.put(@key, ranges)
    end
  end
end
