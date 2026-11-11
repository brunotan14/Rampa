defmodule RampaWeb.ApiSpec do
  @moduledoc """
  Especificação OpenAPI 3 da API do Rampa (PRD §9), montada a partir das operações
  declaradas nos controllers (`operation/2` do `OpenApiSpex.ControllerSpecs`) e dos schemas
  de `RampaWeb.Schemas`.

  Servida em `GET /api/openapi.json` em todos os ambientes. O Swagger UI só existe em dev,
  em `/dev/swagger`: ele carrega os assets de uma CDN (cdnjs) e não passa pelo axe, então
  não pode fazer parte da interface pública.

  A spec só documenta: a validação de entrada continua nos controllers e em
  `Rampa.Audits`, porque os códigos e as mensagens do contrato
  (`{ "error": { "code", "message" } }` em português, 400 para corpo sem `url`, 422 para
  `page_limit`) não cabem no erro padrão do `OpenApiSpex.Plug.CastAndValidate`. O teste de
  contrato (`test/rampa_web/api_spec_test.exs`) confere as respostas reais contra a spec.
  """

  @behaviour OpenApiSpex.OpenApi

  alias OpenApiSpex.{Info, OpenApi, Paths, Server}
  alias RampaWeb.{Endpoint, Router}

  @impl OpenApiSpex.OpenApi
  def spec do
    %OpenApi{
      servers: [Server.from_endpoint(Endpoint)],
      info: %Info{
        title: "Rampa",
        version: to_string(Application.spec(:rampa, :vsn)),
        description:
          "API do Rampa, auditor de acessibilidade web. Todas as mensagens de erro vêm em " <>
            ~s(português do Brasil, no formato `{ "error": { "code", "message" } }`. ) <>
            "A pontuação e os achados são indicadores: a verificação automática não " <>
            "substitui a avaliação com pessoas e tecnologias assistivas."
      },
      paths: Paths.from_router(Router)
    }
    |> OpenApiSpex.resolve_schema_modules()
  end
end
