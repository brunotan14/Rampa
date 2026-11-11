defmodule Rampa.Security.URLGuard do
  @moduledoc """
  Validação e normalização da URL a auditar (RF-RA001) e proteção contra SSRF (RF-RA002).
  Toda URL passa por aqui antes de chegar ao scanner: o `Rampa.Audits.ScanPageJob` valida
  a URL da página antes de cada varredura.

  Normalização:

    * sem esquema, assume `https://` (`exemplo.com`, `exemplo.com:80/x`, `//exemplo.com`);
    * remove o fragmento, põe o host em minúsculas e tira o ponto final;
    * caminho vazio vira `/`; a porta padrão do esquema some;
    * IPv4 em notação não canônica (`127.1`, `0x7f.0.0.1`, `2130706433`) vira a forma
      com pontos, como o navegador faria;
    * nome internacionalizado (IDN) vira punycode antes de qualquer checagem, com a
      biblioteca `idna` (UTS #46, não transicional, como o WHATWG URL Standard):
      `ação.com.br` vira `xn--ao-siap.com.br`. A conversão é por rótulo e só nos rótulos
      fora do ASCII ou em `xn--` (que são conferidos). O mapeamento pode transformar o
      host num nome interno ou num IP (`ｌｏｃａｌｈｏｓｔ`, `①②⑦.0.0.1`), que passam
      pelas checagens de sempre. Fora do host, os bytes fora do ASCII são codificados
      com `%`, como faz o navegador.

  Recusas (`{:error, reason}`):

    * `:invalid_url`: não interpreta, sem host, acima de 2.048 bytes, com
      credenciais (`user:pass@`), com caractere inválido no host (inclusive `%`) ou com
      nome internacionalizado que o IDNA recusa (inclusive rótulo `xn--` inválido);
    * `:unsupported_scheme`: esquema que não é `http` nem `https`;
    * `:blocked_address`: porta fora de 80/443, nome interno (sem ponto, `localhost`,
      `.local`, `.internal`, `.localdomain`, `.home.arpa`) ou IP, literal ou resolvido,
      numa faixa proibida (`Rampa.Security.IPRanges`). Basta **um** IP proibido;
    * `:unresolvable`: o nome não existe ou não tem registro A nem AAAA (definitivo);
    * `:dns_error`: o resolvedor falhou (tempo esgotado, SERVFAIL...), o que pode ser
      passageiro.

  Hosts da `SSRF_ALLOWLIST` (`Rampa.Security.Allowlist`) pulam a checagem de nome e de IP,
  mas não a de esquema nem a de porta.
  """

  alias Rampa.Security.{Allowlist, IPRanges, Resolver}

  @type reason ::
          :invalid_url | :unsupported_scheme | :blocked_address | :unresolvable | :dns_error

  @max_length 2_048
  @schemes ["http", "https"]
  @ports [80, 443]
  @internal_suffixes ["localhost", "local", "internal", "localdomain", "home.arpa"]

  # `exemplo.com:80/x` e `localhost:4000` são host e porta, não esquema e caminho.
  @host_port ~r/\A(?:[^\/?#:@]*\.[^\/?#:@]*|localhost):\d*(?:[\/?#]|\z)/i
  @scheme ~r/\A[a-z][a-z0-9+.\-]*:/i
  @name ~r/\A[a-z0-9_\-]+(?:\.[a-z0-9_\-]+)*\z/
  # Esquema com `//`, autoridade (até `/`, `?` ou `#`) e o resto.
  @authority ~r/\A([a-z][a-z0-9+.\-]*:\/\/)([^\/?#]*)(.*)\z/isu
  @host_and_port ~r/\A(.*?)(:\d*)?\z/su
  @label_separators ~r/[.。．｡]/u

  @doc """
  Valida a URL e devolve a forma normalizada.

  Opções, para os testes: `:allowlist` (padrão: `Allowlist.hosts/0`) e `:resolver`
  (padrão: `Resolver.impl/0`).
  """
  @spec validate(String.t(), keyword()) :: {:ok, String.t()} | {:error, reason()}
  def validate(url, opts \\ [])

  def validate(url, opts) when is_binary(url) do
    allowlist = Keyword.get_lazy(opts, :allowlist, &Allowlist.hosts/0)
    resolver = Keyword.get_lazy(opts, :resolver, &Resolver.impl/0)

    with {:ok, uri} <- parse(url),
         :ok <- check_scheme(uri),
         {:ok, host} <- normalize_host(uri.host),
         :ok <- check_port(uri),
         :ok <- check_address(host, allowlist, resolver) do
      {:ok, serialize(uri, host)}
    end
  end

  def validate(_url, _opts), do: {:error, :invalid_url}

  defp parse(url) do
    url = String.trim(url)

    with true <- url != "" and byte_size(url) <= @max_length,
         {:ok, url} <- url |> with_scheme() |> to_ascii(),
         true <- byte_size(url) <= @max_length,
         {:ok, %URI{userinfo: nil} = uri} <- URI.new(url) do
      {:ok, uri}
    else
      _invalid -> {:error, :invalid_url}
    end
  end

  # IDN (RF-RA001): o host internacionalizado vira punycode e o resto da URL tem os bytes
  # fora do ASCII codificados com `%`, como o navegador faz. URL já em ASCII e sem rótulo
  # `xn--` passa como veio.
  defp to_ascii(url) do
    case Regex.run(@authority, url, capture: :all_but_first) do
      [scheme, authority, rest] ->
        with {:ok, authority} <- ascii_authority(authority),
             do: {:ok, scheme <> authority <> percent_encode(rest)}

      nil ->
        {:ok, percent_encode(url)}
    end
  end

  # Com `@` (credenciais) a URL é recusada adiante; o host não é convertido.
  defp ascii_authority(authority) do
    if String.contains?(authority, "@") do
      {:ok, percent_encode(authority)}
    else
      {host, port} =
        case Regex.run(@host_and_port, authority, capture: :all_but_first) do
          [host, port] -> {host, port}
          [host] -> {host, ""}
        end

      with {:ok, host} <- idna_host(host), do: {:ok, host <> port}
    end
  end

  # Por rótulo, para um rótulo ASCII com `_` (aceito pelo navegador e recusado pelo IDNA2008)
  # não derrubar o nome inteiro. Os separadores de rótulo do UTS #46 (`。`, `．`, `｡`) viram
  # ponto.
  defp idna_host(host) do
    labels = String.split(host, @label_separators)

    if Enum.any?(labels, &idna_label?/1), do: encode_labels(labels), else: {:ok, host}
  end

  defp encode_labels(labels) do
    labels
    |> Enum.reduce_while({:ok, []}, fn label, {:ok, acc} ->
      case idna_label(label) do
        {:ok, label} -> {:cont, {:ok, [label | acc]}}
        :error -> {:halt, :error}
      end
    end)
    |> case do
      {:ok, labels} -> {:ok, labels |> Enum.reverse() |> Enum.join(".")}
      :error -> :error
    end
  end

  defp idna_label?(label),
    do: not ascii?(label) or String.starts_with?(String.downcase(label), "xn--")

  defp idna_label(label) do
    if idna_label?(label) do
      {:ok, label |> String.to_charlist() |> :idna.encode([:uts46]) |> List.to_string()}
    else
      {:ok, label}
    end
  catch
    _kind, _reason -> :error
  end

  defp ascii?(text), do: text =~ ~r/\A[\x00-\x7F]*\z/

  defp percent_encode(text) do
    if ascii?(text), do: text, else: for(<<byte <- text>>, into: "", do: encode_byte(byte))
  end

  defp encode_byte(byte) when byte < 0x80, do: <<byte>>
  defp encode_byte(byte), do: "%" <> Base.encode16(<<byte>>)

  defp with_scheme("//" <> _ = url), do: "https:" <> url

  defp with_scheme(url) do
    if Regex.match?(@scheme, url) and not Regex.match?(@host_port, url),
      do: url,
      else: "https://" <> url
  end

  defp check_scheme(%URI{scheme: scheme}) when scheme in @schemes, do: :ok
  defp check_scheme(_uri), do: {:error, :unsupported_scheme}

  defp check_port(%URI{port: port}) when port in @ports, do: :ok
  defp check_port(_uri), do: {:error, :blocked_address}

  # Devolve `{:ip, tupla}` ou `{:name, texto}`. O IPv6 chega sem colchetes.
  defp normalize_host(host) when host in [nil, ""], do: {:error, :invalid_url}

  defp normalize_host(host) do
    if String.contains?(host, ":") do
      ip_host(IPRanges.parse(host))
    else
      host = host |> String.downcase() |> String.replace_suffix(".", "")

      case IPRanges.parse_url_ipv4(host) do
        :not_ipv4 -> name_host(host)
        result -> ip_host(result)
      end
    end
  end

  defp ip_host({:ok, ip}), do: {:ok, {:ip, ip}}
  defp ip_host(:error), do: {:error, :invalid_url}

  defp name_host(host) do
    valid? =
      byte_size(host) <= 253 and Regex.match?(@name, host) and
        Enum.all?(String.split(host, "."), &(byte_size(&1) <= 63))

    if valid?, do: {:ok, {:name, host}}, else: {:error, :invalid_url}
  end

  defp check_address(host, allowlist, resolver) do
    if host_string(host) in allowlist, do: :ok, else: check_blocked(host, resolver)
  end

  defp check_blocked({:ip, ip}, _resolver), do: check_ips([ip])

  defp check_blocked({:name, name}, resolver) do
    if internal_name?(name) do
      {:error, :blocked_address}
    else
      case resolver.resolve(name) do
        {:ok, [_ | _] = ips} -> check_ips(ips)
        {:ok, []} -> {:error, :unresolvable}
        {:error, :nxdomain} -> {:error, :unresolvable}
        {:error, _reason} -> {:error, :dns_error}
      end
    end
  end

  defp check_ips(ips) do
    if Enum.any?(ips, &IPRanges.blocked?/1), do: {:error, :blocked_address}, else: :ok
  end

  # Sem ponto cobre os nomes do Docker (`postgres`, `app`, `scanner`, `fixtures`).
  defp internal_name?(name) do
    not String.contains?(name, ".") or
      Enum.any?(@internal_suffixes, &(name == &1 or String.ends_with?(name, "." <> &1)))
  end

  defp host_string({:ip, ip}), do: ip |> :inet.ntoa() |> to_string()
  defp host_string({:name, name}), do: name

  defp serialize(%URI{} = uri, host) do
    path = if uri.path in [nil, ""], do: "/", else: uri.path

    URI.to_string(%URI{uri | host: host_string(host), path: path, fragment: nil})
  end
end
