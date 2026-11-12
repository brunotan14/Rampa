defmodule Rampa.ProdConfigTest do
  @moduledoc """
  Configuração de produção que o deploy (`infra/deploy.sh`) pressupõe: o Oban termina os jobs
  em curso antes do SIGKILL do Docker (`stop_grace_period` do `app` em
  `infra/docker-compose.prod.yml`).
  """

  use ExUnit.Case, async: true

  @compose_stop_grace_s 45

  test "o Oban espera os jobs em curso por menos tempo que o stop_grace_period do app" do
    config = Config.Reader.read!(Path.expand("../../config/prod.exs", __DIR__), env: :prod)
    grace_ms = get_in(config, [:rampa, Oban, :shutdown_grace_period])

    assert grace_ms == :timer.seconds(30)
    assert grace_ms < :timer.seconds(@compose_stop_grace_s)

    compose = File.read!(Path.expand("../../../infra/docker-compose.prod.yml", __DIR__))
    assert compose =~ "stop_grace_period: #{@compose_stop_grace_s}s"
  end
end
