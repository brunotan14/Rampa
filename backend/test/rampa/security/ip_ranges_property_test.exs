defmodule Rampa.Security.IPRangesPropertyTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Rampa.IPGenerators
  alias Rampa.Security.IPRanges

  # RF-RA002: o IPv4 embutido em IPv6 (mapeado, NAT64, 6to4) vale o mesmo que o IPv4 puro.
  # Sem isso, `::ffff:127.0.0.1` passaria pela checagem que recusa `127.0.0.1`.

  property "IPv4 mapeado em IPv6 é classificado igual ao IPv4 puro" do
    check all ip <- IPGenerators.mixed_ipv4(), max_runs: 300 do
      mapped = IPGenerators.embed(ip, :mapped)

      assert IPRanges.blocked?(mapped) == IPRanges.blocked?(ip)
      assert IPRanges.unmap(mapped) == ip
    end
  end

  property "NAT64 e 6to4 também seguem o IPv4 embutido" do
    check all ip <- IPGenerators.mixed_ipv4(),
              embedding <- IPGenerators.embedding(),
              embedding != :mapped,
              max_runs: 300 do
      assert IPRanges.blocked?(IPGenerators.embed(ip, embedding)) == IPRanges.blocked?(ip)
    end
  end

  property "todo IP dentro das faixas proibidas é proibido, em qualquer forma" do
    check all ip <- IPGenerators.blocked_ip(), max_runs: 300 do
      assert IPRanges.blocked?(ip)
    end
  end

  property "o texto do IP (inclusive ::ffff:a.b.c.d) volta à mesma tupla" do
    check all ip <- IPGenerators.blocked_ip(), max_runs: 200 do
      text = IPGenerators.to_text(ip)

      assert IPRanges.parse(text) == {:ok, ip}
    end
  end
end
