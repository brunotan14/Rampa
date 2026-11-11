defmodule Rampa.Security.IPHash do
  @moduledoc """
  Hash do IP de quem pede a auditoria (RF-RA002, RNF-RA005): HMAC-SHA256 com o segredo
  `IP_HASH_SECRET`, em hexadecimal. O IP puro nunca vai para o banco nem para o log; só o
  hash, que serve ao limite de taxa e à idempotência do `POST /api/audits`.

  O IP chega já normalizado por `RampaWeb.Plugs.ClientIP` (IPv4 mapeado em IPv6 vira IPv4
  lá, num lugar só). Antes do hash, IPv6 é reduzido ao prefixo `/64`. Uma conexão doméstica recebe um `/64` inteiro e
      pode trocar de endereço dentro dele à vontade; contar por endereço deixaria furar o
      limite de taxa trocando de IP.

  O segredo é obrigatório: sem ele o app não sobe (`check_startup/2`, chamada em
  `Rampa.Application.start/2`). Em produção ele precisa ter pelo menos
  32 caracteres. Dev e test usam um valor fixo da configuração.
  """

  require Logger

  @min_prod_length 32

  @doc "Hash do IP com o segredo configurado (ou o informado)."
  @spec hash(:inet.ip_address(), String.t()) :: String.t()
  def hash(ip, secret \\ secret()) when is_binary(secret) do
    :crypto.mac(:hmac, :sha256, secret, identity(ip)) |> Base.encode16(case: :lower)
  end

  # O texto que identifica a pessoa: o IPv4 ou o prefixo /64 do IPv6.
  defp identity(ip) do
    case ip do
      {_, _, _, _} = ipv4 ->
        ipv4 |> :inet.ntoa() |> to_string()

      {a, b, c, d, _, _, _, _} ->
        {a, b, c, d, 0, 0, 0, 0} |> :inet.ntoa() |> to_string() |> Kernel.<>("/64")
    end
  end

  @doc "Segredo configurado (`config :rampa, :ip_hash_secret`)."
  @spec secret() :: String.t() | nil
  def secret, do: Application.get_env(:rampa, :ip_hash_secret)

  @doc """
  Confere o segredo na subida do app. Sem segredo, em qualquer ambiente, ou com menos de
  #{@min_prod_length} caracteres em `:prod`: registra o motivo no log e devolve
  `{:error, motivo}`, o que impede o app de subir.
  """
  @spec check_startup(atom(), String.t() | nil) :: :ok | {:error, String.t()}
  def check_startup(env, secret) do
    cond do
      secret in [nil, ""] ->
        refuse(
          "IP_HASH_SECRET não está definida. Ela é o segredo do hash do IP de quem pede " <>
            "auditorias (limite de taxa). Gere um valor com `mix phx.gen.secret` e defina a " <>
            "variável para o app subir."
        )

      env == :prod and String.length(secret) < @min_prod_length ->
        refuse(
          "IP_HASH_SECRET tem menos de #{@min_prod_length} caracteres. Gere um valor com " <>
            "`mix phx.gen.secret` e defina a variável para o app subir."
        )

      true ->
        :ok
    end
  end

  defp refuse(reason) do
    Logger.error(reason)
    {:error, reason}
  end
end
