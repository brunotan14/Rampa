defmodule Rampa.Security.Resolver.Inet do
  @moduledoc "Implementação do `Rampa.Security.Resolver` com o resolvedor do sistema (`:inet`)."

  @behaviour Rampa.Security.Resolver

  @timeout 5_000

  @impl true
  def resolve(host) when is_binary(host) do
    name = String.to_charlist(host)

    case {:inet.getaddrs(name, :inet, @timeout), :inet.getaddrs(name, :inet6, @timeout)} do
      {{:error, reason}, {:error, _}} -> {:error, reason}
      {ipv4, ipv6} -> {:ok, addresses(ipv4) ++ addresses(ipv6)}
    end
  end

  defp addresses({:ok, list}), do: Enum.uniq(list)
  defp addresses({:error, _reason}), do: []
end
