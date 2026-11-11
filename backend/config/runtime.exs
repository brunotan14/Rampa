import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/rampa start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :rampa, RampaWeb.Endpoint, server: true
end

config :rampa, RampaWeb.Endpoint, http: [port: String.to_integer(System.get_env("PORT", "4000"))]

config :rampa, :scanner_url, System.get_env("SCANNER_URL", "http://localhost:4100")

# Hosts liberados da proteção contra SSRF, separados por vírgula (RF-RA002). Só o Compose
# de teste preenche. Em produção o app não sobe com ela preenchida
# (`Rampa.Security.Allowlist.check_startup/2`, chamada em `Rampa.Application.start/2`).
config :rampa, :ssrf_allowlist, System.get_env("SSRF_ALLOWLIST", "")

if config_env() != :test do
  config :rampa, Oban,
    queues: [
      scan: String.to_integer(System.get_env("SCAN_CONCURRENCY", "2")),
      ai: 5,
      maintenance: 1
    ]

  # Limites de criação de auditorias (RF-RA002). Nos testes, cada teste escolhe os seus.
  positive_integer = fn name, default ->
    case Integer.parse(System.get_env(name, default)) do
      {value, ""} when value > 0 -> value
      _invalid -> raise "#{name} precisa ser um número inteiro maior que zero"
    end
  end

  config :rampa, :audit_limits,
    per_ip_per_hour: positive_integer.("AUDITS_PER_IP_PER_HOUR", "5"),
    daily: positive_integer.("AUDITS_DAILY_LIMIT", "50")

  # Faixas CIDR do proxy reverso (o Traefik), separadas por vírgula; só delas o
  # `X-Forwarded-For` é considerado (`RampaWeb.Plugs.ClientIP`). Valor inválido impede a
  # subida; vazia em produção gera um aviso (`Rampa.Security.TrustedProxies`).
  config :rampa, :trusted_proxies, System.get_env("TRUSTED_PROXIES", "")
end

# Segredo do HMAC do IP de quem pede auditorias (`Rampa.Security.IPHash`). Obrigatório em
# produção: sem ele o app não sobe. Dev e test têm valor fixo, que a variável sobrescreve
# em dev.
case {config_env(), System.get_env("IP_HASH_SECRET")} do
  {:test, _secret} -> :ok
  {:prod, secret} -> config :rampa, :ip_hash_secret, secret
  {_dev, nil} -> :ok
  {_dev, secret} -> config :rampa, :ip_hash_secret, secret
end

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :rampa, Rampa.Repo,
    # ssl: true,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    # For machines with several cores, consider starting multiple pools of `pool_size`
    # pool_count: 4,
    socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"

  config :rampa, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :rampa, RampaWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://bandit.hexdocs.pm/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0}
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :rampa, RampaWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://plug.hexdocs.pm/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :rampa, RampaWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.
end
