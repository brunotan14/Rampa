defmodule Rampa.Security.Resolver.InetTest do
  use ExUnit.Case, async: true

  alias Rampa.Security.Resolver.Inet

  @ipv4 {93, 184, 215, 14}
  @ipv6 {0x2606, 0x2800, 0x21F, 0, 0, 0, 0, 1}

  # `getaddrs` falso: cada família responde o que o mapa manda, depois de `delay` ms.
  defp getaddrs(answers, delay \\ 0) do
    fn _name, family, _timeout ->
      Process.sleep(delay)
      Map.fetch!(answers, family)
    end
  end

  defp resolve(answers, opts \\ []) do
    Inet.resolve("exemplo.com", Keyword.put_new(opts, :getaddrs, getaddrs(answers)))
  end

  test "junta os IPs das duas famílias" do
    assert {:ok, [@ipv4, @ipv6]} = resolve(%{inet: {:ok, [@ipv4]}, inet6: {:ok, [@ipv6]}})
  end

  test "uma família sem registro não impede a outra" do
    assert {:ok, [@ipv4]} = resolve(%{inet: {:ok, [@ipv4]}, inet6: {:error, :nxdomain}})
    assert {:ok, [@ipv6]} = resolve(%{inet: {:error, :nxdomain}, inet6: {:ok, [@ipv6]}})
  end

  test "as duas sem registro: nxdomain" do
    assert {:error, :nxdomain} = resolve(%{inet: {:error, :nxdomain}, inet6: {:error, :nxdomain}})
  end

  test "falha numa família é erro, mesmo com a outra respondendo" do
    assert {:error, :timeout} = resolve(%{inet: {:error, :timeout}, inet6: {:ok, [@ipv6]}})
    assert {:error, :servfail} = resolve(%{inet: {:ok, [@ipv4]}, inet6: {:error, :servfail}})
  end

  @tag :capture_log
  test "exit na consulta vira erro e não derruba quem chamou" do
    crashing = fn _name, family, _timeout ->
      if family == :inet6, do: exit(:quebrou), else: {:ok, [@ipv4]}
    end

    assert {:error, {:exit, :quebrou}} = Inet.resolve("exemplo.com", getaddrs: crashing)
    assert Process.alive?(self())
  end

  test "consulta as duas famílias em paralelo" do
    started = System.monotonic_time(:millisecond)

    assert {:ok, _} =
             resolve(%{}, getaddrs: getaddrs(%{inet: {:ok, [@ipv4]}, inet6: {:ok, [@ipv6]}}, 300))

    assert System.monotonic_time(:millisecond) - started < 550
  end

  test "o limite vale para a consulta inteira" do
    slow = fn _name, family, _timeout ->
      if family == :inet6, do: Process.sleep(1_000)
      {:ok, [@ipv4]}
    end

    started = System.monotonic_time(:millisecond)
    assert {:error, :timeout} = Inet.resolve("exemplo.com", getaddrs: slow, timeout: 100)
    assert System.monotonic_time(:millisecond) - started < 500
  end
end
