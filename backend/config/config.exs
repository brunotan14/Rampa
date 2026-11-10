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

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id, :audit_id, :page_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Filas de trabalho em segundo plano (PRD §7). O limite de `scan` vem de SCAN_CONCURRENCY em runtime.exs.
config :rampa, Oban,
  engine: Oban.Engines.Basic,
  repo: Rampa.Repo,
  queues: [scan: 2, ai: 5, maintenance: 1]

config :rampa, :scanner_client, Rampa.Scanner.HTTP

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
