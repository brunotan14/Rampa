defmodule RampaWeb.FindingController do
  @moduledoc """
  `GET /api/audits/:audit_id/findings` (PRD §9, RF-RA006): achados da auditoria, com filtros
  (`severity`, `source`, `needs_review`, `page_id`, `wcag`), ordem (`sort`) e paginação por
  cursor (`limit`, `cursor`). `GET /api/audits/:audit_id/findings/:id` (RF-RA007): o
  detalhe de um achado. Regras em `Rampa.Audits.list_findings/2` e
  `Rampa.Audits.get_finding/2`.
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
      "Achados em páginas, na ordem em que foram gravados (`sort=recorded`) ou do mais " <>
        "grave para o menos grave, com os da mesma regra juntos (`sort=severity`). Para a " <>
        "próxima página, envie o `next_cursor` recebido no parâmetro `cursor`, com a mesma " <>
        "ordem; `null` indica a última. `total` é quantos achados passam nos filtros. " <>
        "Achado com `needs_review = true` é sugestão a confirmar manualmente.",
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
      page_id: [
        in: :query,
        description: "Filtra pelos achados de uma página da auditoria.",
        schema: %Schema{type: :string, format: :uuid}
      ],
      wcag: [
        in: :query,
        description: "Filtra pelos achados ligados a um critério WCAG.",
        schema: %Schema{type: :string, pattern: ~r/^[1-4]\.\d{1,2}\.\d{1,2}$/, example: "1.4.3"}
      ],
      sort: [
        in: :query,
        description:
          "Ordem: `recorded` (padrão, ordem de gravação) ou `severity` (mais grave primeiro, " <>
            "depois a regra).",
        schema: %Schema{type: :string, enum: ~w(recorded severity), default: "recorded"}
      ],
      limit: [
        in: :query,
        description: "Achados por página, de 1 a 100 (padrão 50).",
        schema: %Schema{type: :integer, minimum: 1, maximum: 100, default: 50}
      ],
      cursor: [
        in: :query,
        description: "Cursor opaco devolvido em `next_cursor`, da mesma ordem.",
        schema: %Schema{type: :string}
      ]
    ],
    responses: [
      ok: {"Uma página de achados", "application/json", Schemas.FindingsPage},
      not_found: {"Auditoria não encontrada", "application/json", Schemas.AuditNotFound},
      unprocessable_entity:
        {"Filtro, ordem, limite ou cursor inválido", "application/json",
         Schemas.FindingsQueryError}
    ]
  )

  def index(conn, %{"audit_id" => audit_id}) do
    # Só a query string: o `audit_id` do caminho não é filtro.
    with {:ok, page} <- Audits.list_findings(audit_id, conn.query_params) do
      render(conn, :index, page: page)
    end
  end

  operation(:show,
    operation_id: "getFinding",
    summary: "Detalhe de um achado",
    description:
      "Um achado da auditoria, com a página, as ocorrências da mesma regra (nesta página e " <>
        "na auditoria, na mesma lista do axe) e as outras páginas em que ela aparece. " <>
        "Achado de outra auditoria responde 404, como o inexistente.",
    parameters: [
      audit_id: [
        in: :path,
        required: true,
        description: "Id da auditoria.",
        schema: %Schema{type: :string}
      ],
      id: [
        in: :path,
        required: true,
        description: "Id do achado.",
        schema: %Schema{type: :string}
      ]
    ],
    responses: [
      ok: {"Achado", "application/json", Schemas.FindingDetail},
      not_found:
        {"Auditoria ou achado não encontrado", "application/json", Schemas.FindingNotFound}
    ]
  )

  def show(conn, %{"audit_id" => audit_id, "id" => id}) do
    with {:ok, detail} <- Audits.get_finding(audit_id, id) do
      render(conn, :show, detail: detail)
    end
  end
end
