defmodule Rampa.Security.Resolver do
  @moduledoc """
  Resolução de DNS usada pela proteção contra SSRF (RF-RA002). A implementação é
  escolhida por configuração (`:dns_resolver`), para os testes usarem Mox.

  `resolve/1` devolve **todos** os IPs do nome, IPv4 e IPv6: a checagem recusa o host se
  qualquer um deles for proibido.
  """

  @callback resolve(host :: String.t()) :: {:ok, [:inet.ip_address()]} | {:error, term()}

  @spec impl() :: module()
  def impl, do: Application.fetch_env!(:rampa, :dns_resolver)
end
