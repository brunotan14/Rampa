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
  alias Rampa.Scanner.Contract

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
        code: %Schema{type: :string, enum: RampaWeb.Schemas.page_codes()},
        message: %Schema{type: :string},
        http_status: %Schema{
          type: :integer,
          minimum: Contract.error_http_status_range().first,
          maximum: Contract.error_http_status_range().last,
          description:
            "Status HTTP da página que falhou (RF-RA029), quando o site respondeu com erro " <>
              "(`http_error`). Ausente quando não há status. A `message` já o cita."
        }
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
      description:
        "Resumo da auditoria (RF-RA005). A pontuação e os totais são indicadores: a " <>
          "verificação automática não substitui a avaliação com pessoas e tecnologias " <>
          "assistivas.",
      type: :object,
      required: [
        :id,
        :revision,
        :status,
        :start_url,
        :page_limit,
        :pages_found,
        :pages_scanned,
        :pages_failed,
        :score,
        :totals_by_severity,
        :needs_review_by_severity,
        :needs_review_count,
        :login_wall_pages,
        :top_issues,
        :error,
        :started_at,
        :finished_at,
        :inserted_at
      ],
      additionalProperties: false,
      properties: %{
        id: %Schema{type: :string, format: :uuid},
        revision: %Schema{
          type: :integer,
          minimum: 0,
          description:
            "Versão do andamento (RF-RA004). Sobe a cada mudança gravada; é a mesma dos " <>
              "eventos do canal `audit:<id>`. O cliente fica com o estado de maior `revision`."
        },
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
        score: %Schema{
          type: :integer,
          minimum: 0,
          maximum: 100,
          nullable: true,
          description:
            "Indicador de problemas encontrados automaticamente (PRD §10.6). `null` até o M3."
        },
        totals_by_severity: RampaWeb.Schemas.SeverityTotals,
        needs_review_by_severity: %Schema{
          allOf: [RampaWeb.Schemas.SeverityTotals],
          description:
            "Achados que pedem confirmação manual (`needs_review = true`) por severidade. " <>
              "Não somam com `totals_by_severity` nem entram na pontuação."
        },
        top_issues: %Schema{
          type: :array,
          maxItems: 5,
          items: RampaWeb.Schemas.TopIssue,
          description:
            "Até 5 regras com achados confirmados, por páginas afetadas, severidade e " <>
              "ocorrências."
        },
        needs_review_count: %Schema{
          type: :integer,
          minimum: 0,
          description: "Achados que pedem confirmação manual (IA, heurística, incompletos)."
        },
        login_wall_pages: %Schema{
          type: :integer,
          minimum: 0,
          description:
            "Páginas que pedem login (RF-RA028): o Rampa auditou só o que um visitante " <>
              "anônimo vê. Maior que zero, a tela mostra o aviso de barreira de login."
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
        :help,
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
        help: %Schema{
          type: :string,
          nullable: true,
          description: "Resumo da regra, do axe (em inglês até o M3)."
        },
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
      required: [:data, :next_cursor, :total],
      additionalProperties: false,
      properties: %{
        data: %Schema{type: :array, items: RampaWeb.Schemas.Finding},
        total: %Schema{
          type: :integer,
          minimum: 0,
          nullable: true,
          description:
            "Quantos achados passam nos filtros, em todas as páginas da lista. Só na " <>
              "primeira página (sem `cursor`), do instante dela; com `cursor`, `null`."
        },
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
      RampaWeb.Schemas.codes(:create_audit, 400)
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
        "1 a 25. `invalid_idempotency_key`: cabeçalho fora do formato ou repetido. " <>
        "`idempotency_key_reused`: a chave já foi usada por este IP, nas últimas 24 h, " <>
        "para outra URL (comparada depois de normalizada).",
      RampaWeb.Schemas.codes(:create_audit, 422)
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
      RampaWeb.Schemas.codes(:create_audit, 409)
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
      RampaWeb.Schemas.codes(:create_audit, 429),
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
      RampaWeb.Schemas.codes(:create_audit, 503)
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
      "Auditoria inexistente, apagada pela retenção ou id que não é UUID (mesma resposta " <>
        "nos três casos).",
      RampaWeb.Schemas.codes(:get_audit, 404)
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
      "`invalid_filter`: `severity`, `source`, `needs_review`, `page_id` ou `wcag` fora " <>
        "dos valores aceitos. `invalid_sort`: `sort` diferente de `recorded` e `severity`. " <>
        "`invalid_limit`: `limit` fora de 1 a 100. `invalid_cursor`: cursor inválido, de " <>
        "outra ordem ou que aponta para um achado que não existe mais.",
      RampaWeb.Schemas.codes(:list_findings, 422)
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
      RampaWeb.Schemas.codes(:create_audit, 500)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.TopIssue do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  count = %Schema{type: :integer, minimum: 1}

  OpenApiSpex.schema(
    %{
      title: "TopIssue",
      description:
        "Uma das regras mais frequentes entre os achados confirmados. Ocorrências contam " <>
          "os elementos afetados segundo o axe, mesmo além dos 20 exemplos gravados.",
      type: :object,
      required: [
        :rule_id,
        :help,
        :wcag_criteria,
        :severity,
        :pages_affected,
        :occurrences,
        :sample_finding_id
      ],
      additionalProperties: false,
      properties: %{
        rule_id: %Schema{type: :string, example: "image-alt"},
        help: %Schema{type: :string, nullable: true},
        wcag_criteria: %Schema{type: :array, items: %Schema{type: :string}},
        severity: %Schema{
          type: :string,
          enum: ~w(critical serious moderate minor),
          description: "A mais grave entre os achados da regra."
        },
        pages_affected: count,
        occurrences: count,
        sample_finding_id: %Schema{
          type: :string,
          format: :uuid,
          description: "O achado mais grave da regra, para abrir o detalhe."
        }
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.PageSummary do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "PageSummary",
      description: "Uma página da auditoria com as contagens (RF-RA006).",
      type: :object,
      required: [
        :id,
        :url,
        :final_url,
        :title,
        :status,
        :http_status,
        :error,
        :login_wall,
        :scanned_at,
        :counts_by_severity,
        :needs_review_count,
        :passed_count
      ],
      additionalProperties: false,
      properties: RampaWeb.Schemas.page_properties()
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.PagesList do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "PagesList",
      description: "Páginas da auditoria, na ordem em que entraram (no máximo 25).",
      type: :object,
      required: [:data],
      additionalProperties: false,
      properties: %{
        data: %Schema{type: :array, maxItems: 25, items: RampaWeb.Schemas.PageSummary}
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.PassedRule do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "PassedRule",
      description:
        "Regra do axe em que nenhum elemento verificado falhou nesta página (RF-RA017). Não " <>
          "afirma nada sobre a página como um todo. Regra que também falhou em algum " <>
          "elemento da página não aparece aqui.",
      type: :object,
      required: [:rule_id, :wcag_criteria, :help, :nodes_total],
      additionalProperties: false,
      properties: %{
        rule_id: %Schema{type: :string, example: "image-alt"},
        wcag_criteria: %Schema{type: :array, items: %Schema{type: :string}},
        help: %Schema{type: :string, description: "Resumo da regra, do axe."},
        nodes_total: %Schema{
          type: :integer,
          minimum: 0,
          description: "Quantos elementos o axe verificou nesta regra."
        }
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.PageDetail do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "PageDetail",
      description: "Uma página com as regras aprovadas (aba \"Aprovados\", RF-RA017).",
      type: :object,
      required: [
        :id,
        :url,
        :final_url,
        :title,
        :status,
        :http_status,
        :error,
        :login_wall,
        :scanned_at,
        :counts_by_severity,
        :needs_review_count,
        :passed_count,
        :axe_version,
        :passed_rules
      ],
      additionalProperties: false,
      properties:
        Map.merge(RampaWeb.Schemas.page_properties(), %{
          axe_version: %Schema{type: :string, nullable: true},
          passed_rules: %Schema{
            type: :array,
            nullable: true,
            maxItems: 100,
            items: RampaWeb.Schemas.PassedRule,
            description:
              "Regras aprovadas, na ordem do axe. `null` quando não foram coletadas (página " <>
                "que falhou ou varrida antes do RF-RA017); `[]` quando nenhuma passou."
          }
        })
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.FindingDetail do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema
  alias RampaWeb.Schemas.Finding

  nullable_text = %Schema{type: :string, nullable: true}

  finding = Finding.schema()

  OpenApiSpex.schema(
    %{
      title: "FindingDetail",
      description:
        "Um achado por inteiro (RF-RA007). Os critérios WCAG vêm só como número; o título " <>
          "em português, o resumo e o eMAG vêm do catálogo (`GET /api/wcag/criteria`).",
      type: :object,
      required:
        finding.required ++
          [
            :audit_id,
            :help_url,
            :nodes_total,
            :who_is_affected,
            :how_to_fix,
            :ai_reason,
            :ai_suggestion,
            :ai_model,
            :prompt_version,
            :axe_version,
            :inserted_at,
            :page,
            :occurrences,
            :other_pages
          ],
      additionalProperties: false,
      properties:
        Map.merge(finding.properties, %{
          audit_id: %Schema{type: :string, format: :uuid},
          help_url: %Schema{
            type: :string,
            nullable: true,
            description:
              "Documentação da regra no site do axe (dequeuniversity.com); `null` fora dele."
          },
          nodes_total: %Schema{
            type: :integer,
            minimum: 0,
            nullable: true,
            description: "Elementos afetados pela regra na página, segundo o axe."
          },
          who_is_affected: nullable_text,
          how_to_fix: nullable_text,
          ai_reason: nullable_text,
          ai_suggestion: nullable_text,
          ai_model: nullable_text,
          prompt_version: nullable_text,
          axe_version: %Schema{
            type: :string,
            nullable: true,
            description: "Versão do axe que gerou o achado; `null` para IA e heurística."
          },
          inserted_at: %Schema{type: :string, format: :"date-time"},
          page: %Schema{
            type: :object,
            required: [:id, :url, :final_url, :title],
            additionalProperties: false,
            properties: %{
              id: %Schema{type: :string, format: :uuid},
              url: %Schema{type: :string},
              final_url: nullable_text,
              title: nullable_text
            }
          },
          occurrences: %Schema{
            type: :object,
            required: [:page, :audit],
            additionalProperties: false,
            description:
              "Ocorrências da regra na mesma lista do axe (confirmados ou a revisar) nesta " <>
                "página e na auditoria.",
            properties: %{
              page: %Schema{type: :integer, minimum: 0},
              audit: %Schema{type: :integer, minimum: 0}
            }
          },
          other_pages: %Schema{
            type: :array,
            maxItems: 24,
            description: "Outras páginas com a mesma regra, da que tem mais ocorrências.",
            items: %Schema{
              type: :object,
              required: [:page_id, :url, :title, :occurrences],
              additionalProperties: false,
              properties: %{
                page_id: %Schema{type: :string, format: :uuid},
                url: %Schema{type: :string},
                title: nullable_text,
                occurrences: %Schema{type: :integer, minimum: 1}
              }
            }
          }
        })
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.PageNotFound do
  @moduledoc false
  require OpenApiSpex

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "PageNotFound",
      "`audit_not_found`: auditoria inexistente, apagada pela retenção ou id inválido. " <>
        "`page_not_found`: a página não existe nesta auditoria (inclusive a de outra " <>
        "auditoria).",
      RampaWeb.Schemas.codes(:get_page, 404)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.FindingNotFound do
  @moduledoc false
  require OpenApiSpex

  OpenApiSpex.schema(
    RampaWeb.Schemas.error(
      "FindingNotFound",
      "`audit_not_found`: auditoria inexistente, apagada pela retenção ou id inválido. " <>
        "`finding_not_found`: o achado não existe nesta auditoria (inclusive o de outra " <>
        "auditoria).",
      RampaWeb.Schemas.codes(:get_finding, 404)
    ),
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.WcagSource do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "WcagSource",
      description: "Fonte de uma parte do conteúdo, para a atribuição.",
      type: :object,
      required: [:name, :url, :license],
      additionalProperties: false,
      properties: %{
        name: %Schema{type: :string},
        url: %Schema{type: :string, format: :uri},
        license: %Schema{type: :string}
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.WcagCriterion do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema
  alias Rampa.Wcag.Catalog

  text = fn description -> %Schema{type: :string, minLength: 1, description: description} end

  OpenApiSpex.schema(
    %{
      title: "WcagCriterion",
      description:
        "Um critério de sucesso da WCAG 2.2 (RF-RA007). O achado traz só o número " <>
          "(`wcag_criteria`); o cliente cruza com este catálogo. Número fora do catálogo " <>
          "(ex.: 4.1.1, removido na WCAG 2.2) aparece só como número.",
      type: :object,
      required: [:id, :level, :since, :title, :summary, :who_is_affected, :url, :emag],
      additionalProperties: false,
      properties: %{
        id: %Schema{type: :string, pattern: Catalog.criterion_id_pattern(), example: "1.1.1"},
        level: %Schema{type: :string, enum: Catalog.levels()},
        since: %Schema{
          type: :string,
          enum: Catalog.versions(),
          description:
            "Versão da WCAG em que o critério surgiu. O eMAG 3.1 (2014) só cita critérios " <>
              "da 2.0."
        },
        title: text.("Título da Tradução Autorizada da WCAG 2.2 para o português do Brasil."),
        summary: text.("O que o critério pede, em linguagem simples."),
        who_is_affected:
          text.(
            "Quem é afetado e o que acontece. O `who_is_affected` do próprio achado, quando " <>
              "houver, tem precedência sobre este (FR-008)."
          ),
        url: %Schema{
          type: :string,
          format: :uri,
          description: "O critério na tradução autorizada da W3C (em português)."
        },
        emag: %Schema{
          type: :array,
          description:
            "Recomendações do eMAG 3.1 que citam o critério, em ordem numérica; vazio quando " <>
              "nenhuma cita. O link do documento é `sources.emag.url`.",
          items: %Schema{
            type: :object,
            required: [:id, :title],
            additionalProperties: false,
            properties: %{
              id: %Schema{
                type: :string,
                pattern: Catalog.recommendation_id_pattern(),
                example: "3.6"
              },
              title: %Schema{type: :string}
            }
          }
        }
      }
    },
    struct?: false,
    derive?: false
  )
end

defmodule RampaWeb.Schemas.WcagCriteriaResponse do
  @moduledoc false
  require OpenApiSpex

  alias OpenApiSpex.Schema

  OpenApiSpex.schema(
    %{
      title: "WcagCriteriaResponse",
      description:
        "Catálogo dos critérios WCAG em português: os 55 critérios A e AA da WCAG 2.2 e os " <>
          "AAA citados pelas regras do axe que o Rampa roda, em ordem numérica, com as " <>
          "recomendações do eMAG 3.1 que citam cada um. Conteúdo fixo, igual para todas as " <>
          "auditorias.",
      type: :object,
      required: [:content_version, :sources, :data],
      additionalProperties: false,
      properties: %{
        content_version: %Schema{
          type: :string,
          pattern: "^[0-9a-f]{12}$",
          description: "Muda quando qualquer texto, link ou correspondência do catálogo muda."
        },
        sources: %Schema{
          type: :object,
          required: [:wcag, :emag],
          additionalProperties: false,
          properties: %{
            wcag: RampaWeb.Schemas.WcagSource,
            emag: RampaWeb.Schemas.WcagSource
          }
        },
        data: %Schema{type: :array, items: RampaWeb.Schemas.WcagCriterion}
      }
    },
    struct?: false,
    derive?: false
  )
end
