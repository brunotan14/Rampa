defmodule Rampa.Security.Allowlist do
  @moduledoc """
  `SSRF_ALLOWLIST` (RF-RA002): hosts liberados da checagem de nome e de IP, separados por
  vírgula e vazios por padrão. Só o Compose de teste a preenche, para o container
  `fixtures`. Esquema e porta continuam valendo para esses hosts.

  O valor chega cru de `config/runtime.exs` (`:ssrf_allowlist`) e é interpretado aqui.
  Em produção o app se recusa a subir com a lista preenchida (`check_startup/2`, chamada
  em `Rampa.Application.start/2`).
  """

  require Logger

  @doc """
  Interpreta o valor da variável: separa por vírgula, normaliza (minúsculas, sem ponto final
  e sem os colchetes do IPv6, como o scanner) e descarta vazios.
  """
  @spec parse(String.t() | [String.t()] | nil) :: [String.t()]
  def parse(nil), do: []
  def parse(hosts) when is_list(hosts), do: hosts |> Enum.join(",") |> parse()

  def parse(value) when is_binary(value) do
    value
    |> String.split(",")
    |> Enum.map(&normalize/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp normalize(host) do
    host = host |> String.trim() |> String.downcase()

    host =
      if String.starts_with?(host, "[") and String.ends_with?(host, "]"),
        do: String.slice(host, 1..-2//1),
        else: host

    String.replace_suffix(host, ".", "")
  end

  @doc "Hosts liberados pela configuração atual."
  @spec hosts() :: [String.t()]
  def hosts, do: parse(Application.get_env(:rampa, :ssrf_allowlist))

  @doc """
  Confere a lista na subida do app. Em `:prod`, lista preenchida é erro: registra o motivo
  no log e devolve `{:error, motivo}`, o que impede o app de subir. Nos outros ambientes,
  só avisa no log.
  """
  @spec check_startup(atom(), [String.t()]) :: :ok | {:error, String.t()}
  def check_startup(_env, []), do: :ok

  def check_startup(:prod, hosts) do
    reason =
      "SSRF_ALLOWLIST está preenchida em produção (#{Enum.join(hosts, ", ")}). " <>
        "Ela desliga a proteção contra SSRF para esses hosts e só pode ser usada no " <>
        "Compose de teste. Esvazie a variável para o app subir."

    Logger.error(reason)
    {:error, reason}
  end

  def check_startup(_env, hosts) do
    Logger.warning(
      "SSRF_ALLOWLIST preenchida: #{Enum.join(hosts, ", ")} sem checagem de nome e de IP"
    )

    :ok
  end
end
