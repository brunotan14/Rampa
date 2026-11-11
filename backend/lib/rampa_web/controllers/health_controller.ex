defmodule RampaWeb.HealthController do
  use RampaWeb, :controller
  use OpenApiSpex.ControllerSpecs

  alias RampaWeb.Schemas

  tags(["saúde"])

  operation(:show,
    operation_id: "health",
    summary: "Saúde do serviço",
    description: "Confere o app, o banco e o scanner.",
    responses: [
      ok: {"Tudo de pé", "application/json", Schemas.Health},
      service_unavailable: {"Algum componente fora do ar", "application/json", Schemas.Health}
    ]
  )

  def show(conn, _params) do
    checks = Rampa.Health.check()
    status = if Rampa.Health.healthy?(checks), do: :ok, else: :service_unavailable

    conn
    |> put_status(status)
    |> json(%{status: if(status == :ok, do: "ok", else: "error"), checks: checks})
  end
end
