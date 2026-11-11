defmodule Rampa.Security.IPRanges do
  @moduledoc """
  Faixas de IP que o Rampa nunca acessa (RF-RA002): as do PRD mais os registros de
  propósito especial da IANA. A mesma lista existe no scanner (`scanner/src/ssrf/ip.ts`);
  os casos de `shared/ssrf-cases.json` são testados nas duas implementações.

  Três prefixos IPv6 carregam um IPv4 dentro (mapeado, NAT64 e 6to4): o endereço é
  proibido se o IPv4 embutido for proibido.

  Também converte um host IPv4 escrito de forma não canônica (`127.1`, `0x7f.0.0.1`,
  `2130706433`, `0177.0.0.1`) do mesmo jeito que o WHATWG URL Standard, que é o que o
  navegador faz: o backend enxerga o mesmo endereço que o Chromium vai acessar.
  """

  import Bitwise

  @ipv4_blocked [
    {{0, 0, 0, 0}, 8},
    {{10, 0, 0, 0}, 8},
    {{100, 64, 0, 0}, 10},
    {{127, 0, 0, 0}, 8},
    {{169, 254, 0, 0}, 16},
    {{172, 16, 0, 0}, 12},
    {{192, 0, 0, 0}, 24},
    {{192, 0, 2, 0}, 24},
    {{192, 88, 99, 0}, 24},
    {{192, 168, 0, 0}, 16},
    {{198, 18, 0, 0}, 15},
    {{198, 51, 100, 0}, 24},
    {{203, 0, 113, 0}, 24},
    {{224, 0, 0, 0}, 4},
    {{240, 0, 0, 0}, 4},
    {{255, 255, 255, 255}, 32}
  ]

  # `::/96` cobre `::`, `::1` e os IPv4-compatíveis obsoletos (`::127.0.0.1`).
  # `fec0::/10` (site-local, obsoleto) e `3fff::/20`, `5f00::/16`, `64:ff9b:1::/48` vêm do
  # registro da IANA; ficam por segurança.
  @ipv6_blocked [
    {{0, 0, 0, 0, 0, 0, 0, 0}, 96},
    {{0x64, 0xFF9B, 1, 0, 0, 0, 0, 0}, 48},
    {{0x100, 0, 0, 0, 0, 0, 0, 0}, 64},
    {{0x2001, 0, 0, 0, 0, 0, 0, 0}, 23},
    {{0x2001, 0xDB8, 0, 0, 0, 0, 0, 0}, 32},
    {{0x3FFF, 0, 0, 0, 0, 0, 0, 0}, 20},
    {{0x5F00, 0, 0, 0, 0, 0, 0, 0}, 16},
    {{0xFC00, 0, 0, 0, 0, 0, 0, 0}, 7},
    {{0xFE80, 0, 0, 0, 0, 0, 0, 0}, 10},
    {{0xFEC0, 0, 0, 0, 0, 0, 0, 0}, 10},
    {{0xFF00, 0, 0, 0, 0, 0, 0, 0}, 8}
  ]

  # Prefixos com IPv4 embutido: {prefixo, tamanho, deslocamento do IPv4 a partir da direita}.
  @ipv6_embedded [
    # IPv4 mapeado: ::ffff:a.b.c.d
    {{0, 0, 0, 0, 0, 0xFFFF, 0, 0}, 96, 0},
    # NAT64: 64:ff9b::a.b.c.d
    {{0x64, 0xFF9B, 0, 0, 0, 0, 0, 0}, 96, 0},
    # 6to4: 2002:AABB:CCDD::/48, o IPv4 fica nos bits 16 a 48
    {{0x2002, 0, 0, 0, 0, 0, 0, 0}, 16, 80}
  ]

  # As faixas viram inteiros em tempo de compilação.
  to_int = fn ip, width ->
    ip |> Tuple.to_list() |> Enum.reduce(0, fn group, acc -> acc <<< width ||| group end)
  end

  @ipv4_ranges Enum.map(@ipv4_blocked, fn {ip, prefix} -> {to_int.(ip, 8), prefix} end)
  @ipv6_ranges Enum.map(@ipv6_blocked, fn {ip, prefix} -> {to_int.(ip, 16), prefix} end)
  @ipv6_embedded_ranges Enum.map(@ipv6_embedded, fn {ip, prefix, shift} ->
                          {to_int.(ip, 16), prefix, shift}
                        end)

  @doc "Diz se o endereço está numa faixa proibida."
  @spec blocked?(:inet.ip_address()) :: boolean()
  def blocked?({_, _, _, _} = ip), do: ipv4_blocked?(to_integer(ip))

  def blocked?({_, _, _, _, _, _, _, _} = ip) do
    value = to_integer(ip)

    Enum.any?(@ipv6_ranges, fn {net, prefix} -> in_range?(value, net, prefix, 128) end) or
      Enum.any?(@ipv6_embedded_ranges, fn {net, prefix, shift} ->
        in_range?(value, net, prefix, 128) and ipv4_blocked?(value >>> shift &&& 0xFFFFFFFF)
      end)
  end

  @doc """
  Converte o texto de um IP (IPv4 em notação canônica ou IPv6, sem colchetes) em tupla.
  Para hosts IPv4 escritos de outras formas, use `parse_url_ipv4/1`.
  """
  @spec parse(String.t()) :: {:ok, :inet.ip_address()} | :error
  def parse(text) when is_binary(text) do
    case :inet.parse_strict_address(String.to_charlist(text)) do
      {:ok, ip} -> {:ok, ip}
      {:error, _} -> :error
    end
  end

  @doc """
  Converte uma faixa em notação CIDR (`10.0.0.0/8`, `fd00::/8`) ou um IP solto (vira /32 ou
  /128) em `{ip, prefixo}`. Usada pelo `TRUSTED_PROXIES` (`Rampa.Security.TrustedProxies`).
  """
  @spec parse_cidr(String.t()) :: {:ok, {:inet.ip_address(), non_neg_integer()}} | :error
  def parse_cidr(text) when is_binary(text) do
    {address, prefix} =
      case String.split(String.trim(text), "/") do
        [address] -> {address, nil}
        [address, prefix] -> {address, prefix}
        _invalid -> {"", nil}
      end

    with {:ok, ip} <- parse(address),
         bits = bits(ip),
         {:ok, prefix} <- parse_prefix(prefix, bits) do
      {:ok, {ip, prefix}}
    end
  end

  defp parse_prefix(nil, bits), do: {:ok, bits}

  defp parse_prefix(text, bits) do
    case Integer.parse(text) do
      {prefix, ""} when prefix in 0..bits//1 -> {:ok, prefix}
      _invalid -> :error
    end
  end

  @doc "Diz se o IP está na faixa `{rede, prefixo}`. Famílias diferentes nunca casam."
  @spec in_cidr?(:inet.ip_address(), {:inet.ip_address(), non_neg_integer()}) :: boolean()
  def in_cidr?(ip, {net, prefix}) do
    bits = bits(ip)

    bits == bits(net) and in_range?(to_integer(ip), to_integer(net), prefix, bits)
  end

  @doc """
  IPv4 mapeado em IPv6 (`::ffff:a.b.c.d`) vira o IPv4. Com o Phoenix escutando em `::`,
  conexões IPv4 chegam nessa forma.
  """
  @spec unmap(:inet.ip_address()) :: :inet.ip_address()
  def unmap({0, 0, 0, 0, 0, 0xFFFF, high, low}),
    do: {high >>> 8, high &&& 255, low >>> 8, low &&& 255}

  def unmap(ip), do: ip

  defp bits({_, _, _, _}), do: 32
  defp bits({_, _, _, _, _, _, _, _}), do: 128

  @doc """
  Interpreta um host de URL como IPv4, seguindo o WHATWG URL Standard.

    * `:not_ipv4`: o último rótulo não é numérico, então o host é um nome;
    * `{:ok, ip}`: é IPv4 (em qualquer notação aceita pelo navegador);
    * `:error`: parece IPv4, mas é inválido (`256.0.0.1`, `1.2.3.4.5`): o navegador recusa.
  """
  @spec parse_url_ipv4(String.t()) :: {:ok, :inet.ip4_address()} | :not_ipv4 | :error
  def parse_url_ipv4(host) when is_binary(host) do
    parts = String.split(host, ".")

    if ends_in_number?(List.last(parts)), do: parse_ipv4_parts(parts), else: :not_ipv4
  end

  defp ends_in_number?(last), do: last != "" and match?({:ok, _}, parse_ipv4_number(last))

  defp parse_ipv4_parts(parts) when length(parts) > 4, do: :error

  defp parse_ipv4_parts(parts) do
    numbers = Enum.map(parts, &parse_ipv4_number/1)

    with true <- Enum.all?(numbers, &match?({:ok, _}, &1)),
         values = Enum.map(numbers, fn {:ok, n} -> n end),
         {init, [last]} = Enum.split(values, -1),
         true <- Enum.all?(init, &(&1 <= 255)),
         true <- last < 256 ** (5 - length(values)) do
      value =
        init
        |> Enum.with_index()
        |> Enum.reduce(last, fn {n, i}, acc -> acc + n * 256 ** (3 - i) end)

      {:ok, {value >>> 24 &&& 255, value >>> 16 &&& 255, value >>> 8 &&& 255, value &&& 255}}
    else
      _invalid -> :error
    end
  end

  defp parse_ipv4_number(""), do: :error

  defp parse_ipv4_number(<<"0", x, hex::binary>>) when x in [?x, ?X] do
    cond do
      hex == "" -> {:ok, 0}
      hex =~ ~r/\A[0-9a-fA-F]+\z/ -> {:ok, String.to_integer(hex, 16)}
      true -> :error
    end
  end

  defp parse_ipv4_number(<<"0", octal::binary>>) when octal != "" do
    if octal =~ ~r/\A[0-7]+\z/, do: {:ok, String.to_integer(octal, 8)}, else: :error
  end

  defp parse_ipv4_number(decimal) do
    if decimal =~ ~r/\A[0-9]+\z/, do: {:ok, String.to_integer(decimal)}, else: :error
  end

  defp ipv4_blocked?(value),
    do: Enum.any?(@ipv4_ranges, fn {net, prefix} -> in_range?(value, net, prefix, 32) end)

  defp in_range?(value, net, prefix, bits),
    do: value >>> (bits - prefix) == net >>> (bits - prefix)

  defp to_integer({_, _, _, _} = ip), do: to_integer(ip, 8)
  defp to_integer({_, _, _, _, _, _, _, _} = ip), do: to_integer(ip, 16)

  defp to_integer(ip, width) do
    ip |> Tuple.to_list() |> Enum.reduce(0, fn group, acc -> acc <<< width ||| group end)
  end
end
