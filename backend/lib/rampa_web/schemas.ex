defmodule RampaWeb.Schemas do
  @moduledoc """
  Schemas OpenAPI da API (PRD §9), usados pelas operações dos controllers e pelo
  `RampaWeb.ApiSpec`. Descrições em português; nomes de campos em inglês, como na API.

  As respostas têm `additionalProperties: false`: um campo novo que vaze na resposta (como
  `requester_ip_hash` ou `raw`) quebra o teste de contrato.

  Os erros seguem `{ "error": { "code", "message" } }` (`RampaWeb.ErrorJSON`), com os
  `code` possíveis de cada resposta em `enum`.
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

  @doc "Códigos de erro de página e de auditoria (`pages.error`, `audits.error`)."
  @spec scan_error_codes() :: [String.t()]
  def scan_error_codes do
    ~w(blocked_address unsupported_scheme invalid_url unresolvable dns_error timeout
       http_error navigation_failed analysis_failed resource_limit unavailable
       invalid_request invalid_scan_result internal_error stale scan_failed)
  end
end
