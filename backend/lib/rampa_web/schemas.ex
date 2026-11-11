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

  @doc "Códigos (texto) de `pages.error` e `audits.error`, de `Rampa.ErrorCodes`."
  @spec page_codes() :: [String.t()]
  def page_codes, do: Enum.map(Rampa.ErrorCodes.page(), &Atom.to_string/1)
end
