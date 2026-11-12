defmodule RampaWeb.PageController do
  @moduledoc """
  `GET /api/audits/:audit_id/pages` e `GET /api/audits/:audit_id/pages/:id` (RF-RA006,
  RF-RA017). Regras em `Rampa.Audits.list_pages/1` e `Rampa.Audits.get_page/2`.
  """

  use RampaWeb, :controller
  use OpenApiSpex.ControllerSpecs

  alias OpenApiSpex.Schema
  alias Rampa.Audits
  alias RampaWeb.Schemas

  action_fallback RampaWeb.FallbackController

  tags(["auditorias"])

  @audit_id [
    in: :path,
    required: true,
    description: "Id da auditoria (o link do relatório).",
    schema: %Schema{type: :string}
  ]

  operation(:index,
    operation_id: "listPages",
    summary: "Páginas de uma auditoria",
    description:
      "Todas as páginas da auditoria (no máximo 25, sem paginação), na ordem em que " <>
        "entraram, com as contagens de achados e de regras aprovadas. A ordenação da tela " <>
        "fica no cliente. Auditoria apagada pela retenção responde 404, como a inexistente.",
    parameters: [audit_id: @audit_id],
    responses: [
      ok: {"Páginas", "application/json", Schemas.PagesList},
      not_found: {"Auditoria não encontrada", "application/json", Schemas.AuditNotFound}
    ]
  )

  def index(conn, %{"audit_id" => audit_id}) do
    with {:ok, pages} <- Audits.list_pages(audit_id) do
      render(conn, :index, pages: pages)
    end
  end

  operation(:show,
    operation_id: "getPage",
    summary: "Uma página da auditoria",
    description:
      "A página com as contagens e as regras do axe aprovadas nela (aba \"Aprovados\"). " <>
        "Regra aprovada quer dizer só que o axe não encontrou falha daquela regra nos " <>
        "elementos que verificou.",
    parameters: [
      audit_id: @audit_id,
      id: [
        in: :path,
        required: true,
        description: "Id da página.",
        schema: %Schema{type: :string}
      ]
    ],
    responses: [
      ok: {"Página", "application/json", Schemas.PageDetail},
      not_found: {"Auditoria ou página não encontrada", "application/json", Schemas.PageNotFound}
    ]
  )

  def show(conn, %{"audit_id" => audit_id, "id" => id}) do
    with {:ok, page} <- Audits.get_page(audit_id, id) do
      render(conn, :show, page: page)
    end
  end
end
