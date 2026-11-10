defmodule Rampa.Security.Resolver.Inet do
  @moduledoc """
  Implementação do `Rampa.Security.Resolver` com o resolvedor do sistema (`:inet`).

  Consulta A e AAAA em paralelo, com 5 s no total, em tarefas sem link
  (`Rampa.TaskSupervisor`): um `exit` na consulta vira erro, e não derruba quem chamou.
  Na dúvida, fecha:

    * as duas famílias sem registro (`:nxdomain`, que o Erlang usa também para "sem registro
      desse tipo") devolvem `{:error, :nxdomain}`;
    * qualquer outra falha numa das famílias (tempo esgotado, SERVFAIL...) devolve erro,
      mesmo que a outra tenha respondido: devolver só os IPs de uma família esconderia um IP
      proibido da outra.
  """

  @behaviour Rampa.Security.Resolver

  @timeout 5_000

  @impl true
  def resolve(host) when is_binary(host), do: resolve(host, [])

  @doc """
  Como `resolve/1`, com opções para os testes: `:getaddrs` (função de aridade 3, padrão
  `&:inet.getaddrs/3`) e `:timeout` (padrão #{@timeout} ms).
  """
  @spec resolve(String.t(), keyword()) :: {:ok, [:inet.ip_address()]} | {:error, term()}
  def resolve(host, opts) when is_binary(host) do
    getaddrs = Keyword.get(opts, :getaddrs, &:inet.getaddrs/3)
    timeout = Keyword.get(opts, :timeout, @timeout)
    name = String.to_charlist(host)

    [:inet, :inet6]
    |> Enum.map(fn family ->
      Task.Supervisor.async_nolink(Rampa.TaskSupervisor, fn ->
        getaddrs.(name, family, timeout)
      end)
    end)
    |> Task.yield_many(timeout)
    |> Enum.map(fn {task, result} -> result || Task.shutdown(task, :brutal_kill) end)
    |> Enum.map(&family_result/1)
    |> combine()
  end

  defp family_result({:ok, {:ok, ips}}) when is_list(ips), do: {:ok, ips}
  defp family_result({:ok, {:error, :nxdomain}}), do: :none
  defp family_result({:ok, {:error, reason}}), do: {:error, reason}
  defp family_result({:exit, reason}), do: {:error, {:exit, reason}}
  defp family_result(nil), do: {:error, :timeout}

  defp combine(results) do
    cond do
      error = Enum.find(results, &match?({:error, _}, &1)) -> error
      Enum.all?(results, &(&1 == :none)) -> {:error, :nxdomain}
      true -> {:ok, results |> Enum.flat_map(&addresses/1) |> Enum.uniq()}
    end
  end

  defp addresses({:ok, ips}), do: ips
  defp addresses(:none), do: []
end
