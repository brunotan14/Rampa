defmodule RampaWeb.Schemas do
  @moduledoc """
  Schemas OpenAPI da API (PRD §9), usados pelas operações dos controllers e pelo
  `RampaWeb.ApiSpec`. Descrições em português; nomes de campos em inglês, como na API.

  As respostas têm `additionalProperties: false`: um campo novo que vaze na resposta (como
  `requester_ip_hash` ou `raw`) quebra o teste de contrato.

  Os erros seguem `{ "error": { "code", "message" } }` (`RampaWeb.ErrorJSON`), com os
  `code` possíveis de cada resposta em `enum`, derivados de `Rampa.ErrorCodes`.
  """

  alias OpenApiSpex.Schema

  @doc "Schema de erro com os códigos possíveis da resposta."
  @spec error(String.t(), String.t(), [String.t()], map()) :: map()
  def error(title, description, codes, extra_properties \\ %{}) do
    extra_required = Map.keys(extra_properties)

    %{
      title: title,
      description: description,
      type: :object,
      required: [:error],
      additionalProperties: false,
      properties: %{
        error: %Schema{
          type: :object,
          required: [:code, :message] ++ extra_required,
          additionalProperties: false,
          properties:
            Map.merge(
              %{
                code: %Schema{
                  type: :string,
                  enum: codes,
                  description: "Código estável do erro, para o cliente decidir o que fazer."
                },
                message: %Schema{
                  type: :string,
                  description: "Mensagem em português do Brasil, pronta para exibir."
                }
              },
              extra_properties
            )
        }
      }
    }
  end

  @doc "Códigos (texto) da operação com o status, de `Rampa.ErrorCodes`."
  @spec codes(Rampa.ErrorCodes.operation(), pos_integer()) :: [String.t()]
  def codes(operation, status),
    do: operation |> Rampa.ErrorCodes.api(status) |> Enum.map(&Atom.to_string/1)

  @doc "Propriedades comuns da página na lista e no detalhe (RF-RA006)."
  @spec page_properties() :: map()
  def page_properties do
    count = %Schema{type: :integer, minimum: 0}

    %{
      id: %Schema{type: :string, format: :uuid},
      url: %Schema{type: :string, description: "URL pedida, já normalizada."},
      final_url: %Schema{
        type: :string,
        nullable: true,
        description: "URL analisada, depois dos redirecionamentos."
      },
      title: %Schema{type: :string, nullable: true},
      status: %Schema{type: :string, enum: ~w(queued scanning analyzing done failed)},
      http_status: %Schema{type: :integer, nullable: true, minimum: 100, maximum: 599},
      error: RampaWeb.Schemas.AuditError,
      scanned_at: %Schema{type: :string, format: :"date-time", nullable: true},
      counts_by_severity: RampaWeb.Schemas.SeverityTotals,
      needs_review_count: count,
      passed_count: %Schema{
        type: :integer,
        minimum: 0,
        nullable: true,
        description: "Regras aprovadas; `null` quando não foram coletadas."
      }
    }
  end

  @doc "Códigos (texto) de `pages.error` e `audits.error`, de `Rampa.ErrorCodes`."
  @spec page_codes() :: [String.t()]
  def page_codes, do: Enum.map(Rampa.ErrorCodes.page(), &Atom.to_string/1)
end
