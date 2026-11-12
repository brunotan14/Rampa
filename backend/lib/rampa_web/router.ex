defmodule RampaWeb.Router do
  use RampaWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
    plug OpenApiSpex.Plug.PutApiSpec, module: RampaWeb.ApiSpec
  end

  scope "/api", RampaWeb do
    pipe_through :api

    get "/health", HealthController, :show

    post "/audits", AuditController, :create
    get "/audits/:id", AuditController, :show
    get "/audits/:audit_id/pages", PageController, :index
    get "/audits/:audit_id/pages/:id", PageController, :show
    get "/audits/:audit_id/findings", FindingController, :index
    get "/audits/:audit_id/findings/:id", FindingController, :show
  end

  # Especificação OpenAPI (`RampaWeb.ApiSpec`), em todos os ambientes.
  scope "/api" do
    pipe_through :api

    get "/openapi.json", OpenApiSpex.Plug.RenderSpec, []
  end

  # Enable LiveDashboard in development
  if Application.compile_env(:rampa, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through [:fetch_session, :protect_from_forgery]

      live_dashboard "/dashboard", metrics: RampaWeb.Telemetry

      # Swagger UI só em dev: carrega os assets da CDN cdnjs (não é nosso, não passa pelo
      # axe e buscaria arquivos de terceiros na interface pública).
      get "/swagger", OpenApiSpex.Plug.SwaggerUI, path: "/api/openapi.json"
    end
  end
end
