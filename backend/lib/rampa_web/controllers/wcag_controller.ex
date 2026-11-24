defmodule RampaWeb.WcagController do
  @moduledoc """
  `GET /api/wcag/criteria` (RF-RA007): o catálogo dos critérios WCAG em português, com as
  recomendações do eMAG 3.1 que citam cada um. O corpo é montado e codificado na compilação
  (`Rampa.Wcag.body/0`): a resposta só envia o binário.
  """

  use RampaWeb, :controller
  use OpenApiSpex.ControllerSpecs

  alias RampaWeb.Schemas

  tags(["critérios"])

  operation(:index,
    operation_id: "listWcagCriteria",
    summary: "Critérios WCAG em português",
    description:
      "Número, nível, título, resumo, quem é afetado, link oficial e recomendações do eMAG " <>
        "3.1 de cada critério conhecido. Sem parâmetros. O cliente busca uma vez por sessão e " <>
        "cruza com os números de `wcag_criteria` dos achados; em qualquer falha, mostra só os " <>
        "números.",
    responses: [
      ok: {"Catálogo", "application/json", Schemas.WcagCriteriaResponse}
    ]
  )

  def index(conn, _params) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, Rampa.Wcag.body())
  end
end
