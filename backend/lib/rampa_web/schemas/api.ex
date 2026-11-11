# Schemas OpenAPI da API (PRD §9). Helpers e convenções em `RampaWeb.Schemas`.

defmodule RampaWeb.Schemas.CreateAuditRequest do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "CreateAuditRequest",
      description: "Pedido de auditoria (RF-RA001).",
      type: :object,
      required: [:url],
      properties: %{
        url: %Schema{
          type: :string,
          maxLength: 2048,
          description:
            "Endereço a auditar. Só http e https; sem esquema, assume https://. Nomes " <>
              "internacionalizados viram punycode. Recusa credenciais, redes internas e " <>
              "portas diferentes de 80 e 443.",
          example: "exemplo.com"
        },
        page_limit: %Schema{
          type: :integer,
          minimum: 1,
          maximum: 25,
          description:
            "Limite de páginas. Conferido (1 a 25), mas no M1 a auditoria tem sempre uma " <>
              "página; o M5 passa a usar o valor pedido.",
          example: 1
        }
      },
      example: %{url: "https://exemplo.com/", page_limit: 1}
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.CreateAuditResponse do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "CreateAuditResponse",
      description: "Auditoria aceita; a varredura roda em segundo plano.",
      type: :object,
      required: [:id],
      additionalProperties: false,
      properties: %{id: %Schema{type: :string, format: :uuid}},
      example: %{id: "3f1c2b8e-6a0d-4a7e-9d6e-1b2c3d4e5f60"}
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.SeverityTotals do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  count = %Schema{type: :integer, minimum: 0}

  OpenApiSpex.schema(
    %{
      title: "SeverityTotals",
      description:
        "Achados confirmados (`needs_review = false`) por severidade, com os nomes do axe.",
      type: :object,
      required: [:critical, :serious, :moderate, :minor],
      additionalProperties: false,
      properties: %{critical: count, serious: count, moderate: count, minor: count}
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.AuditError do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "AuditError",
      description:
        "Por que a auditoria falhou: o erro da última página que falhou, com a mensagem " <>
          "pronta. `null` enquanto não houver falha.",
      type: :object,
      nullable: true,
      required: [:code, :message],
      additionalProperties: false,
      properties: %{
        code: %Schema{type: :string, enum: RampaWeb.Schemas.scan_error_codes()},
        message: %Schema{type: :string}
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.AuditSummary do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  timestamp = fn description ->
    %Schema{type: :string, format: :"date-time", nullable: true, description: description}
  end

  OpenApiSpex.schema(
    %{
      title: "AuditSummary",
      description: "Resumo da auditoria (mínimo do M1).",
      type: :object,
      required: [
        :id,
        :status,
        :start_url,
        :page_limit,
        :pages_found,
        :pages_scanned,
        :pages_failed,
        :totals_by_severity,
        :needs_review_count,
        :error,
        :started_at,
        :finished_at,
        :inserted_at
      ],
      additionalProperties: false,
      properties: %{
        id: %Schema{type: :string, format: :uuid},
        status: %Schema{
          type: :string,
          enum: ~w(queued running completed failed cancelled),
          description: "Andamento da auditoria."
        },
        start_url: %Schema{type: :string, description: "URL inicial, já normalizada."},
        page_limit: %Schema{type: :integer, minimum: 1, maximum: 25},
        pages_found: %Schema{type: :integer, minimum: 0},
        pages_scanned: %Schema{type: :integer, minimum: 0},
        pages_failed: %Schema{type: :integer, minimum: 0},
        totals_by_severity: RampaWeb.Schemas.SeverityTotals,
        needs_review_count: %Schema{
          type: :integer,
          minimum: 0,
          description: "Achados que pedem confirmação manual (IA, heurística, incompletos)."
        },
        error: RampaWeb.Schemas.AuditError,
        started_at: timestamp.("Início da varredura (UTC)."),
        finished_at: timestamp.("Fim da auditoria (UTC)."),
        inserted_at: %Schema{type: :string, format: :"date-time", description: "Criação (UTC)."}
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.Finding do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "Finding",
      description: "Um problema encontrado numa página.",
      type: :object,
      required: [
        :id,
        :page_id,
        :source,
        :rule_id,
        :wcag_criteria,
        :severity,
        :needs_review,
        :confidence,
        :selector,
        :html_snippet,
        :message
      ],
      additionalProperties: false,
      properties: %{
        id: %Schema{type: :string, format: :uuid},
        page_id: %Schema{type: :string, format: :uuid},
        source: %Schema{type: :string, enum: ~w(axe ai heuristic)},
        rule_id: %Schema{type: :string, example: "image-alt"},
        wcag_criteria: %Schema{
          type: :array,
          items: %Schema{type: :string},
          example: ["1.1.1"]
        },
        severity: %Schema{type: :string, enum: ~w(critical serious moderate minor)},
        needs_review: %Schema{
          type: :boolean,
          description: "Verdadeiro para sugestões que pedem confirmação manual."
        },
        confidence: %Schema{
          type: :number,
          minimum: 0,
          maximum: 1,
          nullable: true,
          description: "Confiança da IA ou da heurística; `null` para o axe."
        },
        selector: %Schema{type: :string, nullable: true},
        html_snippet: %Schema{
          type: :string,
          nullable: true,
          description: "Trecho do HTML do elemento, até 2 KB."
        },
        message: %Schema{type: :string, nullable: true}
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.FindingsPage do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "FindingsPage",
      description: "Uma página de achados.",
      type: :object,
      required: [:data, :next_cursor],
      additionalProperties: false,
      properties: %{
        data: %Schema{type: :array, items: RampaWeb.Schemas.Finding},
        next_cursor: %Schema{
          type: :string,
          nullable: true,
          description: "Cursor opaco da próxima página (parâmetro `cursor`); `null` na última."
        }
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.Health do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  status = %Schema{type: :string, enum: ~w(ok error)}

  OpenApiSpex.schema(
    %{
      title: "Health",
      description: "Saúde do app, do banco e do scanner.",
      type: :object,
      required: [:status, :checks],
      additionalProperties: false,
      properties: %{
        status: status,
        checks: %Schema{
          type: :object,
          required: [:app, :database, :scanner],
          additionalProperties: false,
          properties: %{app: status, database: status, scanner: status}
        }
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.InvalidBodyError do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "InvalidBodyError",
      "Corpo malformado (JSON inválido) ou sem `url` em texto.",
      ~w(invalid_body)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.CreateAuditRefused do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "CreateAuditRefused",
      "Pedido recusado. `unsupported_scheme`: só http e https. `invalid_url`: endereço " <>
        "inválido, com credenciais ou acima de 2.048 caracteres. `blocked_address`: rede " <>
        "interna, nome interno ou porta fora de 80/443 (\"Este endereço não pode ser " <>
        "auditado\"). `unresolvable`: o domínio não existe. `invalid_page_limit`: fora de " <>
        "1 a 25. `invalid_idempotency_key`: cabeçalho fora do formato ou repetido.",
      ~w(unsupported_scheme invalid_url blocked_address unresolvable invalid_page_limit
         invalid_idempotency_key)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.IdempotencyConflictError do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "IdempotencyConflictError",
      "Corrida rara entre duas requisições com a mesma `Idempotency-Key`; repita o pedido.",
      ~w(idempotency_conflict)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.RateLimitError do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "RateLimitError",
      "`rate_limited`: limite de auditorias por hora deste IP; a mensagem traz o horário " <>
        "(São Paulo, HH:MM). `daily_limit_reached`: acabou o limite do dia; vale de novo " <>
        "à meia-noite de São Paulo.",
      ~w(rate_limited daily_limit_reached),
      %{
        retry_after: %Schema{
          type: :string,
          format: :"date-time",
          description: "A partir de quando dá para tentar de novo (ISO 8601, UTC)."
        }
      }
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.DnsError do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "DnsError",
      "Não foi possível verificar o endereço agora (falha passageira do DNS).",
      ~w(dns_error)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.AuditNotFound do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "AuditNotFound",
      "Auditoria inexistente ou id que não é UUID (mesma resposta nos dois casos).",
      ~w(audit_not_found)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.FindingsQueryError do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "FindingsQueryError",
      "`invalid_filter`: `severity`, `source` ou `needs_review` fora dos valores aceitos. " <>
        "`invalid_limit`: `limit` fora de 1 a 100. `invalid_cursor`: cursor inválido.",
      ~w(invalid_filter invalid_limit invalid_cursor)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.InternalError do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "InternalError",
      "Erro inesperado no servidor.",
      ~w(internal_error)
    ),
    struct?: false,
    derive?: false
  )
end
