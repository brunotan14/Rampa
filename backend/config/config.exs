# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :rampa,
  ecto_repos: [Rampa.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

# Configure the endpoint
config :rampa, RampaWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: RampaWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Rampa.PubSub,
  live_view: [signing_salt: "TzSg/1OS"]

# Canal `audit:<id>` (RF-RA004): no máximo tantos canais por conexão (`RampaWeb.AuditChannel`).
config :rampa, :audit_channel, max_per_connection: 10

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id, :audit_id, :page_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Filas de trabalho em segundo plano (PRD §7). O limite de `scan` vem de SCAN_CONCURRENCY em runtime.exs.
#
# Reconciliação de trabalho preso (ciclo de vida em Rampa.Audits.Rules):
#   * Lifeline: devolve à fila o job que ficou `executing` depois de o nó cair. `rescue_after`
#     acima do `timeout` do ScanPageJob (3 min), para nunca resgatar um job vivo;
#   * Cron: `ReconcileTasksJob` a cada 5 min, com os critérios de `:task_reconciliation`.
config :rampa, Oban,
  engine: Oban.Engines.Basic,
  repo: Rampa.Repo,
  queues: [scan: 2, ai: 5, maintenance: 1],
  lifeline: [rescue_after: {5, :minutes}],
  cron: [crontab: [{"*/5 * * * *", Rampa.Audits.ReconcileTasksJob}]]

# Critérios da reconciliação (`Rampa.Audits.reconcile_stale_tasks/1`), em segundos. Só entra
# tarefa sem job vivo no Oban. `running`: timeout do job + `running_grace` (tipos com job) ou
# `stale_running_after` (tipos sem job). `max_requeues`: reenfileiramentos antes de fechar
# a tarefa como `stale`.
config :rampa, :task_reconciliation,
  running_grace: 60,
  stale_running_after: 600,
  stale_pending_after: 600,
  max_requeues: 3,
  batch_size: 500

# Prazo de uma varredura dentro do `ScanPageJob`, em ms: DNS (5 s) + cliente do scanner
# (100 s) + gravação, com folga, e abaixo do `timeout` do job (3 min), que fica de reserva.
config :rampa, :scan_deadline_ms, 150_000

config :rampa, :scanner_client, Rampa.Scanner.HTTP

# Proteção contra SSRF (RF-RA002): DNS atrás de behaviour; `:env` permite a
# `Rampa.Application` recusar a `SSRF_ALLOWLIST` em produção.
config :rampa, :dns_resolver, Rampa.Security.Resolver.Inet
config :rampa, :env, config_env()

# Limites de criação de auditorias (RF-RA002, `Rampa.Audits.Limits`). Fora de test,
# `AUDITS_PER_IP_PER_HOUR` e `AUDITS_DAILY_LIMIT` sobrescrevem em runtime.exs.
config :rampa, :audit_limits, per_ip_per_hour: 5, daily: 50

# Faixas confiáveis para o `X-Forwarded-For` (`TRUSTED_PROXIES`, em runtime.exs). Vazia: vale
# sempre o IP da conexão.
config :rampa, :trusted_proxies, ""

# Fusos (o dia do teto diário e os horários das mensagens são os de São Paulo). Base de
# fusos embutida no pacote `tz`, sem atualização pela rede.
config :elixir, :time_zone_database, Tz.TimeZoneDatabase

# Mensagens ao usuário em português do Brasil (`RampaWeb.ErrorMessages`).
config :rampa, RampaWeb.Gettext, default_locale: "pt_BR"

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
