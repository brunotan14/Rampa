defmodule Rampa.Security.URLGuardTest do
  use ExUnit.Case, async: true

  import Mox

  alias Rampa.Security.{Allowlist, IPRanges, ResolverMock, URLGuard}

  setup :verify_on_exit!

  # Casos compartilhados com o scanner (`scanner/test/ssrf.test.ts`).
  @cases_path Path.expand("../../../../shared/ssrf-cases.json", __DIR__)
  @external_resource @cases_path
  @cases @cases_path |> File.read!() |> Jason.decode!()

  @public_ip {93, 184, 215, 14}

  # Nome que passa na checagem de nome resolve para IP público, como no scanner.
  defp stub_public_dns, do: stub(ResolverMock, :resolve, fn _host -> {:ok, [@public_ip]} end)

  defp validate(url, opts \\ []),
    do: URLGuard.validate(url, Keyword.put_new(opts, :allowlist, []))

  describe "RF-RA002: critérios de aceite" do
    test "recusa http://localhost:4000 sem consultar o DNS" do
      assert {:error, :blocked_address} = validate("http://localhost:4000")
    end

    test "recusa http://169.254.169.254/" do
      assert {:error, :blocked_address} = validate("http://169.254.169.254/")
    end

    test "recusa domínio que resolve para 10.0.0.5" do
      expect(ResolverMock, :resolve, fn "interno.exemplo.com" -> {:ok, [{10, 0, 0, 5}]} end)

      assert {:error, :blocked_address} = validate("https://interno.exemplo.com/")
    end

    test "recusa se qualquer um dos IPs resolvidos for proibido" do
      expect(ResolverMock, :resolve, fn _host ->
        {:ok, [@public_ip, {0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1111}, {0, 0, 0, 0, 0, 0, 0, 1}]}
      end)

      assert {:error, :blocked_address} = validate("https://misto.exemplo.com/")
    end

    test "aceita domínio cujos IPs são todos públicos" do
      expect(ResolverMock, :resolve, fn "exemplo.com" ->
        {:ok, [@public_ip, {0x2606, 0x2800, 0x21F, 0, 0, 0, 0, 1}]}
      end)

      assert {:ok, "https://exemplo.com/"} = validate("https://exemplo.com")
    end

    test "nome sem registro é recusado como unresolvable" do
      expect(ResolverMock, :resolve, fn _host -> {:error, :nxdomain} end)
      assert {:error, :unresolvable} = validate("https://nao-existe.exemplo.com/")

      expect(ResolverMock, :resolve, fn _host -> {:ok, []} end)
      assert {:error, :unresolvable} = validate("https://vazio.exemplo.com/")
    end

    test "falha do resolvedor vira dns_error, que é passageiro" do
      for reason <- [:timeout, :servfail, :etimedout, {:exit, :quebrou}] do
        expect(ResolverMock, :resolve, fn _host -> {:error, reason} end)
        assert {:error, :dns_error} = validate("https://instavel.exemplo.com/")
      end
    end
  end

  describe "RF-RA001: critérios de aceite" do
    test "recusa ftp://exemplo.com e javascript:alert(1)" do
      assert {:error, :unsupported_scheme} = validate("ftp://exemplo.com")
      assert {:error, :unsupported_scheme} = validate("javascript:alert(1)")
    end

    test "exemplo.com sem esquema vira https://exemplo.com/" do
      stub_public_dns()
      assert {:ok, "https://exemplo.com/"} = validate("exemplo.com")
    end
  end

  describe "normalização" do
    setup do
      stub_public_dns()
      :ok
    end

    for {input, expected} <- [
          {"exemplo.com", "https://exemplo.com/"},
          {"  exemplo.com  ", "https://exemplo.com/"},
          {"//exemplo.com", "https://exemplo.com/"},
          {"//exemplo.com/a?b=1", "https://exemplo.com/a?b=1"},
          {"exemplo.com:80/x", "https://exemplo.com:80/x"},
          {"exemplo.com:443/x", "https://exemplo.com/x"},
          {"exemplo.com/contato#topo", "https://exemplo.com/contato"},
          {"HTTPS://Exemplo.COM", "https://exemplo.com/"},
          {"https://exemplo.com./", "https://exemplo.com/"},
          {"https://exemplo.com:443/a", "https://exemplo.com/a"},
          {"http://exemplo.com:80/a", "http://exemplo.com/a"},
          {"http://exemplo.com/a?q=1#frag", "http://exemplo.com/a?q=1"},
          {"http://exemplo.com?q=1", "http://exemplo.com/?q=1"},
          {"http://0x08.8.8.8/", "http://8.8.8.8/"},
          {"http://134744072/", "http://8.8.8.8/"},
          {"http://[2606:4700:4700:0:0:0:0:1111]/", "http://[2606:4700:4700::1111]/"},
          {"http://xn--ao-5ja.com.br/", "http://xn--ao-5ja.com.br/"},
          {"ação.com.br", "https://xn--ao-siap.com.br/"},
          {"https://AÇÃO.com.br:443/contato#topo", "https://xn--ao-siap.com.br/contato"},
          {"https://a_b.ação.com.br/", "https://a_b.xn--ao-siap.com.br/"}
        ] do
      test "#{inspect(input)} vira #{expected}" do
        assert {:ok, unquote(expected)} = validate(unquote(input))
      end
    end

    test "localhost:4000 sem esquema é host e porta, não esquema" do
      assert {:error, :blocked_address} = validate("localhost:4000")
    end

    test "mailto: e data: são esquemas não suportados" do
      assert {:error, :unsupported_scheme} = validate("mailto:alguem@exemplo.com")
      assert {:error, :unsupported_scheme} = validate("data:text/html,oi")
    end

    for input <- [
          "",
          "   ",
          "https://",
          "https:///caminho",
          "https://exemplo .com/",
          "https://exemplo.com\\@127.0.0.1/",
          "https://%6cocalhost/",
          "https://exemplo..com/",
          "https://-.com/x y",
          "https://xn--zz.com/",
          "https://-ação.com/"
        ] do
      test "#{inspect(input)} é recusada como inválida" do
        assert {:error, :invalid_url} = validate(unquote(input))
      end
    end

    test "URL longa demais é recusada" do
      assert {:error, :invalid_url} =
               validate("https://exemplo.com/" <> String.duplicate("a", 2_100))
    end

    test "javascript: com texto fora do ASCII continua sendo esquema não suportado" do
      assert {:error, :unsupported_scheme} = validate("javascript:alert('ação')")
    end

    test "separador de rótulo ideográfico em nome ASCII vira ponto, como no WHATWG" do
      assert {:ok, "https://exemplo.com.br/"} = validate("https://exemplo。com.br/")
      assert {:ok, "https://exemplo.com.br/"} = validate("https://exemplo．com｡br/")
      assert {:ok, "https://exemplo.com/"} = validate("https://exemplo.com。/")
      assert {:error, :blocked_address} = validate("http://localhost。/")
    end

    test "IDN que vira nome interno ou IP proibido é bloqueado sem consultar o DNS" do
      assert {:error, :blocked_address} = validate("http://ｌｏｃａｌｈｏｓｔ/")
      assert {:error, :blocked_address} = validate("http://①②⑦.0.0.1/")
    end

    test "valor que não é texto é recusado" do
      assert {:error, :invalid_url} = URLGuard.validate(nil, allowlist: [])
      assert {:error, :invalid_url} = URLGuard.validate(123, allowlist: [])
    end
  end

  describe "nomes internos não consultam o DNS" do
    # Sem stub: se o resolver fosse chamado, o Mox falharia.
    for host <- ~w(postgres app scanner fixtures localhost a.localhost impressora.local
                   db.internal nas.localdomain roteador.home.arpa home.arpa) do
      test "#{host}" do
        assert {:error, :blocked_address} = validate("http://#{unquote(host)}/")
      end
    end
  end

  describe "SSRF_ALLOWLIST" do
    test "com SSRF_ALLOWLIST=fixtures, fixtures é liberado e postgres continua bloqueado" do
      assert {:ok, "http://fixtures/limpa.html"} =
               validate("http://fixtures/limpa.html", allowlist: ["fixtures"])

      assert {:error, :blocked_address} = validate("http://postgres/", allowlist: ["fixtures"])
    end

    test "host liberado não consulta o DNS, mas a porta e o esquema valem" do
      assert {:error, :blocked_address} =
               validate("http://fixtures:8080/", allowlist: ["fixtures"])

      assert {:error, :unsupported_scheme} = validate("ftp://fixtures/", allowlist: ["fixtures"])
    end

    test "a comparação é exata: subdomínio não é liberado" do
      expect(ResolverMock, :resolve, fn "a.fixtures.com" -> {:ok, [{10, 0, 0, 1}]} end)

      assert {:error, :blocked_address} =
               validate("http://a.fixtures.com/", allowlist: ["fixtures.com"])
    end

    test "IPv6 na lista, com ou sem colchetes, libera o mesmo host" do
      for entry <- ["::1", "[::1]"] do
        allowlist = Allowlist.parse(entry)
        assert {:ok, "http://[::1]/"} = validate("http://[::1]/", allowlist: allowlist)
        assert {:error, :blocked_address} = validate("http://[::2]/", allowlist: allowlist)
      end
    end

    test "sem a opção, usa a configuração" do
      assert {:error, :blocked_address} = URLGuard.validate("http://fixtures/")
    end
  end

  describe "casos compartilhados com o scanner: IPs" do
    for %{"ip" => ip, "blocked" => blocked, "range" => range} <- @cases["ips"] do
      test "#{ip} (#{range}) #{if blocked, do: "é proibido", else: "é permitido"}" do
        assert {:ok, address} = IPRanges.parse(unquote(ip))
        assert IPRanges.blocked?(address) == unquote(blocked)
      end
    end

    for %{"ip" => ip, "blocked" => blocked} <- @cases["ips"] do
      test "domínio que resolve para #{ip}" do
        assert {:ok, address} = IPRanges.parse(unquote(ip))
        expect(ResolverMock, :resolve, fn "site.exemplo.com" -> {:ok, [address]} end)

        result = validate("https://site.exemplo.com/")

        if unquote(blocked),
          do: assert({:error, :blocked_address} = result),
          else: assert({:ok, "https://site.exemplo.com/"} = result)
      end
    end
  end

  describe "casos compartilhados com o scanner: URLs" do
    setup do
      stub_public_dns()
      :ok
    end

    for %{"url" => url, "expected" => expected} = test_case <- @cases["urls"] do
      raw = Map.get(test_case, "allowlist", [])
      # A lista passa pela mesma interpretação da variável de ambiente, como no scanner.
      allowlist = Allowlist.parse(raw)
      normalized = Map.get(test_case, "normalized")

      test "#{url} #{if raw != [], do: "(allowlist #{Enum.join(raw, ",")}) "}→ #{expected}" do
        result = validate(unquote(url), allowlist: unquote(allowlist))

        case {unquote(expected), unquote(normalized)} do
          # IDN: o mesmo resultado do WHATWG URL no scanner.
          {"ok", nil} -> assert {:ok, _normalized} = result
          {"ok", normalized} -> assert {:ok, ^normalized} = result
          {reason, _} -> assert {:error, String.to_existing_atom(reason)} == result
        end
      end
    end
  end

  describe "IPv4 na notação do navegador" do
    for {host, expected} <- [
          {"127.1", {:ok, {127, 0, 0, 1}}},
          {"0x7f.0.0.1", {:ok, {127, 0, 0, 1}}},
          {"0177.0.0.1", {:ok, {127, 0, 0, 1}}},
          {"2130706433", {:ok, {127, 0, 0, 1}}},
          {"0x7f000001", {:ok, {127, 0, 0, 1}}},
          {"10.1", {:ok, {10, 0, 0, 1}}},
          {"192.168.257", {:ok, {192, 168, 1, 1}}},
          {"0x", {:ok, {0, 0, 0, 0}}},
          {"4294967295", {:ok, {255, 255, 255, 255}}},
          {"4294967296", :error},
          {"1.2.3.256", :error},
          {"1.2.65536", :error},
          {"08.0.0.1", :error},
          {"exemplo.com", :not_ipv4},
          {"1.2.3.exemplo", :not_ipv4},
          {"exemplo.123abc", :not_ipv4}
        ] do
      test "#{host}" do
        assert IPRanges.parse_url_ipv4(unquote(host)) == unquote(Macro.escape(expected))
      end
    end
  end
end
