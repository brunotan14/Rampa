defmodule RampaWeb.SpaController do
  @moduledoc """
  Fallback da SPA (PRD §7): todo `GET` que não é da API, do tempo real nem um arquivo do
  build devolve o `index.html`, e o React Router escolhe a tela (`/auditorias/:id`, a página
  de 404 da interface...).

  Os prefixos reservados (`RampaWeb.Static.reserved?/1`) respondem como rota inexistente, no
  pipeline `:browser` do `RampaWeb.Router`: `/api/*` continua com o 404 em JSON
  (`{ "error": { "code", "message" } }`), e um arquivo de `assets/` que não existe não vira
  HTML. Sem o build (`mix phx.server` em dev, onde a interface é a do Vite), também é 404.

  O `index.html` vem de `RampaWeb.Static.index/0`, lido na compilação, com ETag.
  """

  use RampaWeb, :controller

  alias RampaWeb.Static

  # Uma cláusula só, escolhida na compilação: com o build, o `index.html` e o ETag ficam no
  # módulo; sem ele, toda rota da interface é 404.
  case Static.index() do
    {:ok, body, etag} ->
      @body body
      @etag etag

      def index(conn, _params), do: send_index(conn, @body, @etag)

      # `cache-control: no-cache` (`RampaWeb.Plugs.BrowserHeaders`) faz o navegador revalidar
      # a cada visita: com o mesmo build, o ETag bate e a resposta é 304, sem corpo.
      defp send_index(conn, body, etag) do
        conn = put_resp_header(conn, "etag", etag)

        if etag_matches?(get_req_header(conn, "if-none-match"), etag) do
          send_resp(conn, 304, "")
        else
          conn
          |> put_resp_content_type("text/html")
          |> send_resp(200, body)
        end
      end

      defp etag_matches?(values, etag) do
        values
        |> Enum.flat_map(&String.split(&1, ","))
        |> Enum.map(&String.trim/1)
        |> Enum.any?(&(&1 in [etag, "W/" <> etag, "*"]))
      end

    :error ->
      def index(conn, _params) do
        raise Phoenix.Router.NoRouteError, conn: conn, router: RampaWeb.Router
      end
  end
end
