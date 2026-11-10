defmodule RampaWeb.HealthController do
  use RampaWeb, :controller

  def show(conn, _params) do
    checks = Rampa.Health.check()
    status = if Rampa.Health.healthy?(checks), do: :ok, else: :service_unavailable

    conn
    |> put_status(status)
    |> json(%{status: if(status == :ok, do: "ok", else: "error"), checks: checks})
  end
end
