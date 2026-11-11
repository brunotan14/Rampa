defmodule RampaWeb.AuditController do
  @moduledoc """
  `POST /api/audits` e `GET /api/audits/:id` (PRD §9; RF-RA001, RF-RA002). A regra de
  negócio fica em `Rampa.Audits`; aqui só a leitura da requisição e a resposta. Erros em
  `RampaWeb.FallbackController`.
  """

  use RampaWeb, :controller
  use OpenApiSpex.ControllerSpecs

  alias OpenApiSpex.{Header, Schema}
  alias Rampa.Audits
  alias RampaWeb.Schemas

  # Só a criação precisa de quem pede (hash do IP para o limite de taxa e a idempotência).
  plug RampaWeb.Plugs.ClientIP when action == :create

  action_fallback RampaWeb.FallbackController

  tags(["auditorias"])

  @retry_after %Header{
    description: "Segundos até poder tentar de novo.",
    schema: %Schema{type: :integer, minimum: 1}
  }

  operation(:create,
    operation_id: "createAudit",
    summary: "Cria uma auditoria",
    description:
      "Valida a URL (RF-RA001) e a proteção contra SSRF (RF-RA002), confere os limites de " <>
        "taxa (por IP na última hora e o teto do dia) e cria a auditoria `queued` com a " <>
        "varredura da primeira página em segundo plano. No M1 a auditoria tem uma página.",
    parameters: [
      "Idempotency-Key": [
        in: :header,
        required: false,
        description:
          "Chave opcional, de 1 a 128 caracteres ASCII visíveis. Repetir a mesma chave do " <>
            "mesmo IP em até 24 h devolve 202 com o mesmo `id`, sem criar outra auditoria " <>
            "nem contar no limite.",
        schema: %Schema{type: :string, minLength: 1, maxLength: 128, pattern: ~r/^[!-~]+$/}
      ]
    ],
    request_body: {"Endereço a auditar", "application/json", Schemas.CreateAuditRequest},
    responses: [
      accepted: {"Auditoria aceita", "application/json", Schemas.CreateAuditResponse},
      bad_request:
        {"Corpo malformado ou sem `url`", "application/json", Schemas.InvalidBodyError},
      conflict:
        {"Mesma chave em uso por outra requisição", "application/json",
         Schemas.IdempotencyConflictError},
      unprocessable_entity:
        {"URL, `page_limit` ou chave recusados", "application/json", Schemas.CreateAuditRefused},
      too_many_requests:
        {"Limite de taxa ou teto diário atingido", "application/json", Schemas.RateLimitError,
         headers: %{"Retry-After" => @retry_after}},
      internal_server_error: {"Erro inesperado", "application/json", Schemas.InternalError},
      service_unavailable:
        {"Não foi possível verificar o endereço agora", "application/json", Schemas.DnsError}
    ]
  )

  @doc """
  Cria a auditoria. Corpo `{ "url": string, "page_limit"?: integer }`; cabeçalho opcional
  `Idempotency-Key`. 202 com `{ "id" }`. `page_limit` é conferido (1 a 25), mas no M1 a
  auditoria tem sempre uma página (`Rampa.Audits.create_audit/3`).
  """
  def create(conn, %{"url" => url} = params) when is_binary(url) do
    with {:ok, key} <- idempotency_key(conn),
         {:ok, audit} <-
           Audits.create_audit(url, %{ip_hash: conn.assigns.requester_ip_hash},
             page_limit: params["page_limit"],
             idempotency_key: key
           ) do
      conn
      |> put_status(:accepted)
      |> json(%{id: audit.id})
    end
  end

  def create(_conn, _params), do: {:error, :invalid_body}

  operation(:show,
    operation_id: "getAudit",
    summary: "Resumo de uma auditoria",
    description:
      "Status, contadores, totais por severidade (só achados confirmados) e o erro, se a " <>
        "auditoria falhou.",
    parameters: [
      id: [
        in: :path,
        required: true,
        description: "Id da auditoria.",
        schema: %Schema{type: :string}
      ]
    ],
    responses: [
      ok: {"Resumo", "application/json", Schemas.AuditSummary},
      not_found: {"Auditoria não encontrada", "application/json", Schemas.AuditNotFound}
    ]
  )

  @doc "Resumo da auditoria (mínimo do M1). 404 `audit_not_found` para id inválido ou inexistente."
  def show(conn, %{"id" => id}) do
    with {:ok, summary} <- Audits.get_audit_summary(id) do
      render(conn, :show, summary: summary)
    end
  end

  # Um cabeçalho só; repetido é inválido. O formato é conferido em `create_audit/3`.
  defp idempotency_key(conn) do
    case get_req_header(conn, "idempotency-key") do
      [] -> {:ok, nil}
      [key] -> {:ok, key}
      _repeated -> {:error, :invalid_idempotency_key}
    end
  end
end
