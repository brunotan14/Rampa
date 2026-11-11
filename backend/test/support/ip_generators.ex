defmodule Rampa.IPGenerators do
  @moduledoc """
  Geradores de IP (StreamData) para os testes por propriedade da proteção contra SSRF
  (RF-RA002).

  As faixas proibidas ficam repetidas aqui de propósito, como especificação independente
  (PRD, RF-RA002, e os registros de propósito especial da IANA): se uma faixa sumir de
  `Rampa.Security.IPRanges`, os IPs gerados dentro dela passam a ser aceitos e a
  propriedade falha.
  """

  import Bitwise

  alias StreamData, as: SD

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

  @doc "IPv4 dentro de uma das faixas proibidas."
  def blocked_ipv4, do: in_ranges(@ipv4_blocked, 8, 32)

  @doc "IPv6 dentro de uma das faixas IPv6 proibidas (sem IPv4 embutido)."
  def blocked_ipv6, do: in_ranges(@ipv6_blocked, 16, 128)

  @doc "Qualquer IPv4."
  def ipv4, do: SD.map(SD.integer(0..0xFFFFFFFF), &int_to_ipv4/1)

  @doc "IPv4 qualquer, com metade das amostras dentro das faixas proibidas."
  def mixed_ipv4, do: SD.one_of([ipv4(), blocked_ipv4()])

  @doc """
  As três formas IPv6 que carregam um IPv4: mapeado (`::ffff:a.b.c.d`), NAT64
  (`64:ff9b::a.b.c.d`) e 6to4 (`2002:AABB:CCDD::/48`, com os 80 bits restantes livres).
  """
  def embed(ipv4, :mapped), do: from_int(0xFFFF <<< 32 ||| to_int(ipv4), 16, 8)
  def embed(ipv4, :nat64), do: from_int(0x64FF9B <<< 96 ||| to_int(ipv4), 16, 8)

  def embed(ipv4, {:six_to_four, low_bits}),
    do: from_int(0x2002 <<< 112 ||| to_int(ipv4) <<< 80 ||| low_bits, 16, 8)

  @doc "Forma de embutir IPv4 em IPv6, para `embed/2`."
  def embedding do
    SD.one_of([
      SD.constant(:mapped),
      SD.constant(:nat64),
      SD.map(SD.integer(0..((1 <<< 80) - 1)), &{:six_to_four, &1})
    ])
  end

  @doc "IP proibido em qualquer forma: IPv4, IPv6 ou IPv4 proibido embutido em IPv6."
  def blocked_ip do
    SD.one_of([
      blocked_ipv4(),
      blocked_ipv6(),
      SD.bind(blocked_ipv4(), fn ip -> SD.map(embedding(), &embed(ip, &1)) end)
    ])
  end

  @doc "IPs públicos fixos (um IPv4 e um IPv6, fora de qualquer faixa), para misturar com os proibidos."
  def public_ips, do: [{93, 184, 215, 14}, {0x2606, 0x2800, 0x21F, 0, 0, 0, 0, 1}]

  @doc """
  Texto do IP, sem o sufixo de zona: o `:inet.ntoa/1` escreve `fe80:0:1::1%01` para endereços
  de enlace local cujo segundo grupo não é zero, e a zona não é parte do IP que se quer testar.
  """
  def to_text(ip), do: ip |> :inet.ntoa() |> to_string() |> String.split("%") |> hd()

  defp in_ranges(ranges, width, bits) do
    ranges
    |> Enum.map(fn {net, prefix} ->
      free = bits - prefix
      base = to_int(net, width)

      SD.map(SD.integer(0..((1 <<< free) - 1)), fn offset ->
        from_int(base ||| offset, width, div(bits, width))
      end)
    end)
    |> SD.one_of()
  end

  defp int_to_ipv4(value), do: from_int(value, 8, 4)

  defp to_int({_, _, _, _} = ip), do: to_int(ip, 8)

  defp to_int(ip, width),
    do: ip |> Tuple.to_list() |> Enum.reduce(0, fn group, acc -> acc <<< width ||| group end)

  defp from_int(value, width, count) do
    mask = (1 <<< width) - 1

    (count - 1)..0//-1
    |> Enum.map(fn i -> value >>> (i * width) &&& mask end)
    |> List.to_tuple()
  end
end
