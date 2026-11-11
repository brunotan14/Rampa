defmodule Rampa.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  alias Rampa.Security.{Allowlist, IPHash, TrustedProxies}

  @impl true
  def start(_type, _args) do
    env = Application.fetch_env!(:rampa, :env)

    # RF-RA002: em produção, `SSRF_ALLOWLIST` preenchida impede a subida; sem
    # `IP_HASH_SECRET` ou com `TRUSTED_PROXIES` inválida, o app não sobe em nenhum ambiente.
    with :ok <- Allowlist.check_startup(env, Allowlist.hosts()),
         :ok <- IPHash.check_startup(env, IPHash.secret()),
         :ok <- TrustedProxies.load(env, Application.get_env(:rampa, :trusted_proxies)) do
      start_children()
    end
  end

  defp start_children do
    children = [
      RampaWeb.Telemetry,
      Rampa.Repo,
      {DNSCluster, query: Application.get_env(:rampa, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Rampa.PubSub},
      # Tarefas sem link com quem chamou (ex.: consultas de DNS do `Resolver.Inet`).
      {Task.Supervisor, name: Rampa.TaskSupervisor},
      {Oban, Application.fetch_env!(:rampa, Oban)},
      # Start to serve requests, typically the last entry
      RampaWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Rampa.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    RampaWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
