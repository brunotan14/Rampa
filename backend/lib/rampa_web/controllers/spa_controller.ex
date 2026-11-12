defmodule RampaWeb.SpaController do
  @moduledoc """
  Fallback da SPA (PRD §7): todo `GET` que não é da API, do tempo real nem um arquivo do
  build devolve o `index.html`, e o React Router escolhe a tela (`/auditorias/:id`, a página
  de 404 da interface...).

  Os prefixos reservados (`RampaWeb.Static.reserved?/1`) respondem como rota inexistente, no
  pipeline `:browser` do `RampaWeb.Router`: `/api/*` continua com o 404 em JSON
  (`{ "error": { "code", "message" } }`), e um arquivo de `assets/` que não existe não vira
  HTML. Sem o build (`mix phx.server` em dev, onde a interface é a do Vite), também é 404.
  """

  use RampaWeb, :controller

  alias RampaWeb.Static

  def index(conn, _params) do
    index = Static.index_path()

    unless File.regular?(index) do
      raise Phoenix.Router.NoRouteError, conn: conn, router: RampaWeb.Router
    end

    conn
    |> put_resp_content_type("text/html")
    |> send_file(200, index)
  end
end
