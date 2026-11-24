defmodule Rampa.Wcag do
  @moduledoc """
  Catálogo dos critérios WCAG em português (RF-RA007): os 55 critérios A e AA da WCAG 2.2 e os
  AAA citados pelas regras do axe que o Rampa roda, cada um com título da tradução autorizada
  da W3C, resumo e "quem é afetado" escritos pelo Rampa, link oficial e as recomendações do
  eMAG 3.1 que o citam.

  O conteúdo vem de `shared/wcag/` (`criteria.pt-BR.json`, `emag-3.1.pt-BR.json`, validados
  por `content.schema.json`) e é lido, validado (`Rampa.Wcag.Catalog.build/2`) e montado **na
  compilação**: conteúdo inválido quebra o build com um `CompileError` que lista os problemas, e
  a release não precisa dos arquivos em tempo de execução. Por isso o build do backend precisa
  de `shared/` ao lado de `backend/` (no Docker, `COPY shared/wcag/ /app/shared/wcag/` antes do
  `mix compile`). Mudou um dos três arquivos, o módulo é recompilado (`@external_resource`).
  Correção de texto chega pelo deploy normal, sem migration (FR-016).

  O corpo de `GET /api/wcag/criteria` também é codificado na compilação (`body/0`).
  """

  alias Rampa.Wcag.Catalog

  @criteria_path Path.join(Catalog.dir(), "criteria.pt-BR.json")
  @emag_path Path.join(Catalog.dir(), "emag-3.1.pt-BR.json")
  @external_resource @criteria_path
  @external_resource @emag_path
  @external_resource Catalog.schema_path()

  @catalog (case Catalog.build(Catalog.read!(@criteria_path), Catalog.read!(@emag_path)) do
              {:ok, catalog} ->
                catalog

              {:error, errors} ->
                raise CompileError,
                  description:
                    "conteúdo dos critérios WCAG inválido em #{Catalog.dir()}:\n" <>
                      Enum.map_join(errors, "\n", &"  * #{&1}")
            end)

  @criteria @catalog.criteria
  @by_id Map.new(@criteria, &{&1.id, &1})
  @sources @catalog.sources
  @content_version @catalog.content_version
  @body @catalog.body

  @doc "O catálogo inteiro, em ordem numérica por componente (1.4.5 antes de 1.4.10)."
  @spec all() :: [Catalog.criterion()]
  def all, do: @criteria

  @doc """
  O critério pelo número. Fora do catálogo (o 4.1.1, removido na WCAG 2.2; AAA que nenhuma
  regra cita; número inexistente) é `:error`: quem mostra exibe só o número (FR-010).
  """
  @spec get(term()) :: {:ok, Catalog.criterion()} | :error
  def get(id) when is_binary(id), do: Map.fetch(@by_id, id)
  def get(_id), do: :error

  @doc "O número é um critério do catálogo."
  @spec known?(term()) :: boolean()
  def known?(id) when is_binary(id), do: is_map_key(@by_id, id)
  def known?(_id), do: false

  @doc "Versão do conteúdo: muda quando qualquer texto, link ou correspondência muda."
  @spec content_version() :: String.t()
  def content_version, do: @content_version

  @doc "Fontes e licenças do conteúdo (W3C e eMAG), para a atribuição."
  @spec sources() :: Catalog.sources()
  def sources, do: @sources

  @doc "Corpo JSON de `GET /api/wcag/criteria`, codificado na compilação."
  @spec body() :: String.t()
  def body, do: @body
end
