import Config

# Force using SSL in production. This also sets the "strict-security-transport" header,
# known as HSTS. If you have a health check endpoint, you may want to exclude it below.
# Note `:force_ssl` is required to be set at compile-time.
config :rampa, RampaWeb.Endpoint,
  force_ssl: [
    rewrite_on: [:x_forwarded_proto],
    exclude: [
      # paths: ["/health"],
      hosts: ["localhost", "127.0.0.1"]
    ]
  ]

# Na troca de versão (`infra/deploy.sh`), o Docker manda SIGTERM e espera o
# `stop_grace_period` do `app` em `infra/docker-compose.prod.yml` (45 s) antes do SIGKILL. O
# Oban para de pegar jobs e espera até 30 s os que estão rodando; o que passar disso volta à
# fila pelo Lifeline e pela reconciliação (os jobs são idempotentes).
config :rampa, Oban, shutdown_grace_period: :timer.seconds(30)

# Do not print debug messages in production
config :logger, level: :info

# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
