defmodule Rampa.Security.URLGuard do
  @moduledoc """
  Validação e normalização da URL a auditar (RF-RA001) e proteção contra SSRF (RF-RA002).
  Toda URL passa por aqui antes de chegar ao scanner: na criação da auditoria e de novo no
  `Rampa.Audits.ScanPageJob`, antes de cada varredura.

  Normalização:

    * sem esquema, assume `https://` (`exemplo.com`, `exemplo.com:80/x`, `//exemplo.com`);
    * remove o fragmento, põe o host em minúsculas e tira o ponto final;
    * caminho vazio vira `/`; a porta padrão do esquema some;
    * IPv4 em notação não canônica (`127.1`, `0x7f.0.0.1`, `2130706433`) vira a forma
      com pontos, como o navegador faria.

  Recusas (`{:error, reason}`):

    * `:invalid_url`: não interpreta, sem host, com credenciais (`user:pass@`), com
      caractere inválido no host (inclusive `%`) ou com host fora do ASCII. Nomes
      internacionalizados (IDN) ainda não são convertidos para punycode, porque o
      Elixir não traz IDNA e o projeto não usa dependência para isso. A pessoa pode
      informar o nome já em punycode (`xn--...`);
    * `:unsupported_scheme`: esquema que não é `http` nem `https`;
    * `:blocked_address`: porta fora de 80/443, nome interno (sem ponto, `localhost`,
      `.local`, `.internal`, `.localdomain`, `.home.arpa`) ou IP, literal ou resolvido,
      numa faixa proibida (`Rampa.Security.IPRanges`). Basta **um** IP proibido;
    * `:unresolvable`: o DNS não devolveu nenhum IP.

  Hosts da `SSRF_ALLOWLIST` (`Rampa.Security.Allowlist`) pulam a checagem de nome e de IP,
  mas não a de esquema nem a de porta.
  """

  alias Rampa.Security.{Allowlist, IPRanges, Resolver}

  @type reason :: :invalid_url | :unsupported_scheme | :blocked_address | :unresolvable

  @max_length 2_048
  @schemes ["http", "https"]
  @ports [80, 443]
  @internal_suffixes ["localhost", "local", "internal", "localdomain", "home.arpa"]

  # `exemplo.com:80/x` e `localhost:4000` são host e porta, não esquema e caminho.
  @host_port ~r/\A(?:[^\/?#:@]*\.[^\/?#:@]*|localhost):\d*(?:[\/?#]|\z)/i
  @scheme ~r/\A[a-z][a-z0-9+.\-]*:/i
  @name ~r/\A[a-z0-9_\-]+(?:\.[a-z0-9_\-]+)*\z/

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
         {:ok, %URI{userinfo: nil} = uri} <- url |> with_scheme() |> URI.new() do
      {:ok, uri}
    else
      _invalid -> {:error, :invalid_url}
    end
  end

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
        _empty_or_error -> {:error, :unresolvable}
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
