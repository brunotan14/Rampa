defmodule RampaWeb.FindingController do
  @moduledoc """
  `GET /api/audits/:id/findings` (PRD §9): achados da auditoria, com filtros (`severity`,
  `source`, `needs_review`) e paginação por cursor (`limit`, `cursor`). Regras em
  `Rampa.Audits.list_findings/2`.
  """

  use RampaWeb, :controller
  use OpenApiSpex.ControllerSpecs

  alias OpenApiSpex.Schema
  alias Rampa.Audits
  alias RampaWeb.Schemas

  action_fallback RampaWeb.FallbackController

  tags(["auditorias"])

  operation(:index,
    operation_id: "listFindings",
    summary: "Achados de uma auditoria",
    description:
      "Achados na ordem em que foram gravados, em páginas. Para a próxima página, envie o " <>
        "`next_cursor` recebido no parâmetro `cursor`; `null` indica a última. Achado " <>
        "com `needs_review = true` é sugestão a confirmar manualmente.",
    parameters: [
      audit_id: [
        in: :path,
        required: true,
        description: "Id da auditoria.",
        schema: %Schema{type: :string}
      ],
      severity: [
        in: :query,
        description: "Filtra pela severidade (nomes do axe).",
        schema: %Schema{type: :string, enum: ~w(critical serious moderate minor)}
      ],
      source: [
        in: :query,
        description: "Filtra pela origem do achado.",
        schema: %Schema{type: :string, enum: ~w(axe ai heuristic)}
      ],
      needs_review: [
        in: :query,
        description: "Filtra pelos achados que pedem (ou não) revisão manual.",
        schema: %Schema{type: :string, enum: ~w(true false)}
      ],
      limit: [
        in: :query,
        description: "Achados por página, de 1 a 100 (padrão 50).",
        schema: %Schema{type: :integer, minimum: 1, maximum: 100, default: 50}
      ],
      cursor: [
        in: :query,
        description: "Cursor opaco devolvido em `next_cursor`.",
        schema: %Schema{type: :string}
      ]
    ],
    responses: [
      ok: {"Uma página de achados", "application/json", Schemas.FindingsPage},
      not_found: {"Auditoria não encontrada", "application/json", Schemas.AuditNotFound},
      unprocessable_entity:
        {"Filtro, limite ou cursor inválido", "application/json", Schemas.FindingsQueryError}
    ]
  )

  def index(conn, %{"audit_id" => audit_id} = params) do
    with {:ok, page} <- Audits.list_findings(audit_id, Map.delete(params, "audit_id")) do
      render(conn, :index, page: page)
    end
  end
end
