defmodule RampaWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :rampa

  # Cabeçalhos de `/api/*` também nas respostas de erro do `render_errors`: envolve o
  # `call/2` do endpoint (ver `RampaWeb.Plugs.ApiHeaders`).
  @before_compile RampaWeb.Plugs.ApiHeaders

  # The session will be stored in the cookie and signed,
  # this means its contents can be read but not tampered with.
  # Set :encryption_salt if you would also like to encrypt it.
  @session_options [
    store: :cookie,
    key: "_rampa_key",
    signing_salt: "kEnaPEYu",
    same_site: "Lax"
  ]

  # Tempo real (RF-RA004): canal `audit:<id>`. Só websocket; o cliente só manda join e
  # heartbeat, então o quadro é pequeno. `check_origin` vem da configuração do endpoint
  # (`config/runtime.exs` em produção, `RampaWeb.Origins`).
  socket "/socket", RampaWeb.AuditSocket,
    websocket: [max_frame_size: 8_192, compress: false],
    longpoll: false

  # O Rampa não usa LiveView: este socket existe só para o LiveDashboard de dev
  # (`/dev/dashboard`). Fora de dev, seria um websocket com sessão sem função.
  if Application.compile_env(:rampa, :dev_routes) do
    socket "/live", Phoenix.LiveView.Socket,
      websocket: [connect_info: [session: @session_options]],
      longpoll: [connect_info: [session: @session_options]]
  end

  # Build do frontend (PRD §7): os arquivos de `RampaWeb.static_paths/0`. O cache e os
  # cabeçalhos vêm de `RampaWeb.Static`, também na 304 (o `:headers` do `Plug.Static` não
  # vale nela). O `gzip` serve o `.gz` gerado no build da imagem (`backend/Dockerfile`). O
  # resto das rotas da interface cai no `index.html` (`RampaWeb.SpaController`).
  plug RampaWeb.Static

  plug Plug.Static,
    at: "/",
    from: RampaWeb.Static.from(),
    gzip: not code_reloading?,
    only: RampaWeb.static_paths(),
    raise_on_missing_only: code_reloading?

  # Code reloading can be explicitly enabled under the
  # :code_reloader configuration of your endpoint.
  if code_reloading? do
    plug Phoenix.CodeReloader
    plug Phoenix.Ecto.CheckRepoStatus, otp_app: :rampa
  end

  plug Phoenix.LiveDashboard.RequestLogger,
    param_key: "request_logger",
    cookie_key: "request_logger"

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug Plug.MethodOverride
  plug Plug.Head
  plug Plug.Session, @session_options
  plug RampaWeb.Router
end
