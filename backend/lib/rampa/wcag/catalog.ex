defmodule Rampa.Wcag.Catalog do
  @moduledoc """
  Validação e montagem do catálogo de critérios WCAG (RF-RA007) a partir dos arquivos de
  `shared/wcag/`. Funções puras: `Rampa.Wcag` chama `build/2` **na compilação** e transforma
  os erros num `CompileError`; os testes chamam `build/2` com dados inválidos.

  O schema `shared/wcag/content.schema.json` (JSON Schema draft-07, validado com
  `ex_json_schema`) é lido e resolvido na compilação deste módulo, como em
  `Rampa.Scanner.Contract`. Depois do schema, `build/2` confere o que um JSON Schema não
  expressa:

    * os 55 critérios A e AA da WCAG 2.2 estão todos lá, cada um com o nível certo; fora deles,
      só critérios AAA (os citados pelas regras do axe que o Rampa roda); o 4.1.1, removido na
      WCAG 2.2, não entra;
    * nenhum `id` repetido, nos critérios e nas recomendações;
    * `since` é `"2.0"` exatamente para os critérios que já existiam na WCAG 2.0;
    * links só dos sites oficiais (FR-005): a tradução autorizada da W3C nos critérios, o
      governo federal no eMAG;
    * as 45 recomendações do eMAG 3.1, cada uma na sua seção, e toda citação `wcag20` é um
      critério da WCAG 2.0 (lista fixa dos 61, de todos os níveis);
    * texto sem espaço nas pontas e sem caractere de controle.

  A correspondência com o eMAG é **derivada**: cada critério ganha as recomendações que o
  citam, em ordem numérica. Citação de critério fora do catálogo (4.1.1, AAA que nenhuma regra
  cita) é ignorada.
  """

  @dir Path.expand("../../../../shared/wcag", __DIR__)
  @schema_path Path.join(@dir, "content.schema.json")
  @external_resource @schema_path

  @doc "Lê e decodifica um JSON de `shared/wcag/`; arquivo ausente ou inválido é `CompileError`."
  @spec read!(Path.t()) :: term()
  def read!(path) do
    with {:ok, json} <- File.read(path),
         {:ok, decoded} <- Jason.decode(json) do
      decoded
    else
      {:error, %Jason.DecodeError{} = error} ->
        raise CompileError,
          description: "#{path} não é um JSON válido: #{Exception.message(error)}"

      {:error, reason} ->
        raise CompileError,
          description:
            "conteúdo dos critérios WCAG não encontrado em #{path} " <>
              "(#{:file.format_error(reason)}): o build do backend precisa de shared/ ao lado " <>
              "de backend/"
    end
  end

  @schema (case File.read(@schema_path) do
             {:ok, json} ->
               Jason.decode!(json)

             {:error, reason} ->
               raise CompileError,
                 description:
                   "schema do conteúdo WCAG não encontrado em #{@schema_path} " <>
                     "(#{:file.format_error(reason)}): o build do backend precisa de shared/ " <>
                     "ao lado de backend/"
           end)

  @root ExJsonSchema.Schema.resolve(@schema)

  @fragments %{
    criteria: ExJsonSchema.Schema.get_fragment!(@root, "#/definitions/CriteriaFile"),
    emag: ExJsonSchema.Schema.get_fragment!(@root, "#/definitions/EmagFile")
  }

  @levels get_in(@schema, ["definitions", "Level", "enum"])
  @versions get_in(@schema, ["definitions", "Since", "enum"])
  @criterion_id_pattern get_in(@schema, ["definitions", "CriterionId", "pattern"])
  @recommendation_id_pattern get_in(@schema, [
                               "definitions",
                               "Recommendation",
                               "properties",
                               "id",
                               "pattern"
                             ])

  # Research R1: os 55 critérios A e AA da WCAG 2.2 (o 4.1.1 foi removido na 2.2).
  @required_a ~w(1.1.1 1.2.1 1.2.2 1.2.3 1.3.1 1.3.2 1.3.3 1.4.1 1.4.2 2.1.1 2.1.2 2.1.4
                 2.2.1 2.2.2 2.3.1 2.4.1 2.4.2 2.4.3 2.4.4 2.5.1 2.5.2 2.5.3 2.5.4 3.1.1
                 3.2.1 3.2.2 3.2.6 3.3.1 3.3.2 3.3.7 4.1.2)
  @required_aa ~w(1.2.4 1.2.5 1.3.4 1.3.5 1.4.3 1.4.4 1.4.5 1.4.10 1.4.11 1.4.12 1.4.13
                  2.4.5 2.4.6 2.4.7 2.4.11 2.5.7 2.5.8 3.1.2 3.2.3 3.2.4 3.3.3 3.3.4 3.3.8
                  4.1.3)
  @required_levels Map.merge(
                     Map.new(@required_a, &{&1, "A"}),
                     Map.new(@required_aa, &{&1, "AA"})
                   )

  @removed_in_22 ["4.1.1"]

  # Os 61 critérios da WCAG 2.0, de todos os níveis: as citações do eMAG 3.1 (2014) são todas
  # da 2.0, e `since: "2.0"` vale exatamente para eles.
  @wcag20 ~w(1.1.1 1.2.1 1.2.2 1.2.3 1.2.4 1.2.5 1.2.6 1.2.7 1.2.8 1.2.9 1.3.1 1.3.2 1.3.3
             1.4.1 1.4.2 1.4.3 1.4.4 1.4.5 1.4.6 1.4.7 1.4.8 1.4.9 2.1.1 2.1.2 2.1.3 2.2.1
             2.2.2 2.2.3 2.2.4 2.2.5 2.3.1 2.3.2 2.4.1 2.4.2 2.4.3 2.4.4 2.4.5 2.4.6 2.4.7
             2.4.8 2.4.9 2.4.10 3.1.1 3.1.2 3.1.3 3.1.4 3.1.5 3.1.6 3.2.1 3.2.2 3.2.3 3.2.4
             3.2.5 3.3.1 3.3.2 3.3.3 3.3.4 3.3.5 3.3.6 4.1.1 4.1.2)
  @wcag20_set MapSet.new(@wcag20)

  # Research R3: as 45 recomendações do eMAG 3.1, por seção (o primeiro número do id).
  @emag_sections %{
    "1" => {"Marcação", 9},
    "2" => {"Comportamento (DOM)", 7},
    "3" => {"Conteúdo/Informação", 12},
    "4" => {"Apresentação/Design", 4},
    "5" => {"Multimídia", 5},
    "6" => {"Formulário", 8}
  }
  @emag_ids for {section, {_name, count}} <- @emag_sections,
                n <- 1..count,
                do: "#{section}.#{n}"

  # FR-005: só os sites oficiais.
  @criterion_url_prefix "https://www.w3.org/Translations/WCAG22-pt-BR/#"
  @emag_url_prefixes [
    "https://www.gov.br/governodigital/",
    "https://emag.governoeletronico.gov.br/"
  ]

  @wcag_source %{
    name: "WCAG 2.2, Tradução Autorizada para o português do Brasil (W3C, 27/03/2025)",
    url: "https://www.w3.org/Translations/WCAG22-pt-BR-20250327/",
    license: "W3C Document License"
  }
  @emag_source_name "Modelo de Acessibilidade em Governo Eletrônico (eMAG) 3.1"
  @emag_source_license "CC BY 4.0"

  # O que pode vir depois do prefixo: o fragmento do critério (o mesmo do original em
  # inglês) e o caminho no site do eMAG, só ASCII visível.
  @fragment ~r/\A[a-z0-9]+(-[a-z0-9]+)*\z/
  @url_path ~r/\A[!-~]*\z/

  @control_chars ~r/[\x{0000}-\x{001F}\x{007F}-\x{009F}]/u

  @type emag_ref :: %{id: String.t(), title: String.t()}

  @type criterion :: %{
          id: String.t(),
          level: String.t(),
          since: String.t(),
          title: String.t(),
          summary: String.t(),
          who_is_affected: String.t(),
          url: String.t(),
          emag: [emag_ref()]
        }

  @type source :: %{name: String.t(), url: String.t(), license: String.t()}
  @type sources :: %{wcag: source(), emag: source()}

  @type t :: %{
          criteria: [criterion()],
          sources: sources(),
          content_version: String.t(),
          body: String.t()
        }

  @doc "Diretório do conteúdo (`shared/wcag/`)."
  @spec dir() :: Path.t()
  def dir, do: @dir

  @doc "Caminho do JSON Schema usado na compilação."
  @spec schema_path() :: Path.t()
  def schema_path, do: @schema_path

  @doc "Níveis aceitos (`Level` do schema)."
  @spec levels() :: [String.t()]
  def levels, do: @levels

  @doc "Versões da WCAG aceitas em `since` (`Since` do schema)."
  @spec versions() :: [String.t()]
  def versions, do: @versions

  @doc "Padrão do número do critério (`CriterionId` do schema)."
  @spec criterion_id_pattern() :: String.t()
  def criterion_id_pattern, do: @criterion_id_pattern

  @doc "Padrão do número da recomendação do eMAG (`Recommendation.id` do schema)."
  @spec recommendation_id_pattern() :: String.t()
  def recommendation_id_pattern, do: @recommendation_id_pattern

  @doc "Os 55 critérios A e AA da WCAG 2.2 com o nível de cada um (research R1)."
  @spec required_levels() :: %{String.t() => String.t()}
  def required_levels, do: @required_levels

  @doc "Os 61 critérios da WCAG 2.0, de todos os níveis."
  @spec wcag20() :: [String.t()]
  def wcag20, do: @wcag20

  @doc "Prefixo obrigatório do link de cada critério."
  @spec criterion_url_prefix() :: String.t()
  def criterion_url_prefix, do: @criterion_url_prefix

  @doc "Prefixos aceitos para o link do documento do eMAG."
  @spec emag_url_prefixes() :: [String.t()]
  def emag_url_prefixes, do: @emag_url_prefixes

  @doc """
  Valida os dois arquivos decodificados (`criteria.pt-BR.json` e `emag-3.1.pt-BR.json`) e
  monta o catálogo derivado, ou devolve **todos** os problemas encontrados, em português.
  """
  @spec build(term(), term()) :: {:ok, t()} | {:error, [String.t()]}
  def build(criteria_doc, emag_doc) do
    with [] <- schema_errors(criteria_doc, emag_doc),
         [] <- criteria_errors(criteria_doc["criteria"]) ++ emag_errors(emag_doc) do
      {:ok, derive(criteria_doc["criteria"], emag_doc)}
    else
      errors -> {:error, errors}
    end
  end

  @doc """
  Os 12 primeiros dígitos hexadecimais do SHA-256 do catálogo derivado (`sources` e os
  critérios) serializado em JSON. Muda quando qualquer texto, link ou correspondência muda, e
  só nesse caso: a serialização tem a ordem das chaves fixa (`encode/2`), sem depender da
  ordem interna dos mapas, que muda entre execuções da VM.
  """
  @spec content_version(sources(), [criterion()]) :: String.t()
  def content_version(sources, criteria) do
    :sha256
    |> :crypto.hash(encode(sources, criteria))
    |> Base.encode16(case: :lower)
    |> binary_part(0, 12)
  end

  @doc """
  JSON do catálogo com a ordem das chaves do contrato (`contracts/wcag-criteria.md`). Sem
  `content_version` (para calcular a versão); com ela, é o corpo de `GET /api/wcag/criteria`.
  """
  @spec encode(sources(), [criterion()], String.t() | nil) :: String.t()
  def encode(sources, criteria, content_version \\ nil) do
    catalog = [
      sources: ordered(wcag: ordered_source(sources.wcag), emag: ordered_source(sources.emag)),
      data: Enum.map(criteria, &ordered_criterion/1)
    ]

    fields =
      if content_version, do: [{:content_version, content_version} | catalog], else: catalog

    fields |> ordered() |> Jason.encode!()
  end

  defp ordered_source(source),
    do: ordered(name: source.name, url: source.url, license: source.license)

  defp ordered_criterion(criterion) do
    ordered(
      id: criterion.id,
      level: criterion.level,
      since: criterion.since,
      title: criterion.title,
      summary: criterion.summary,
      who_is_affected: criterion.who_is_affected,
      url: criterion.url,
      emag: Enum.map(criterion.emag, &ordered(id: &1.id, title: &1.title))
    )
  end

  defp ordered(fields), do: Jason.OrderedObject.new(fields)

  @doc "Chave de ordenação numérica por componente (1.4.5 antes de 1.4.10; 3.9 antes de 3.10)."
  @spec sort_key(String.t()) :: [non_neg_integer()]
  def sort_key(id), do: id |> String.split(".") |> Enum.map(&String.to_integer/1)

  # Schema

  defp schema_errors(criteria_doc, emag_doc) do
    schema_errors(:criteria, "criteria.pt-BR.json", criteria_doc) ++
      schema_errors(:emag, "emag-3.1.pt-BR.json", emag_doc)
  end

  defp schema_errors(kind, file, doc) do
    case ExJsonSchema.Validator.validate_fragment(@root, Map.fetch!(@fragments, kind), doc) do
      :ok ->
        []

      {:error, errors} ->
        Enum.map(errors, fn {message, path} -> "#{file} #{path}: #{message}" end)
    end
  end

  # Critérios

  defp criteria_errors(criteria) do
    ids = Enum.map(criteria, & &1["id"])
    present = MapSet.new(ids)

    missing =
      @required_levels
      |> Map.keys()
      |> Enum.reject(&MapSet.member?(present, &1))
      |> Enum.sort_by(&sort_key/1)

    missing_errors =
      if missing == [],
        do: [],
        else: [
          "criteria.pt-BR.json: faltam critérios A/AA da WCAG 2.2: #{Enum.join(missing, ", ")}"
        ]

    duplicates(ids, &"criteria.pt-BR.json: critério #{&1} repetido") ++
      missing_errors ++ Enum.flat_map(criteria, &criterion_errors/1)
  end

  defp criterion_errors(%{"id" => id} = criterion) do
    where = "criteria.pt-BR.json: critério #{id}"

    [
      level_error(where, id, criterion["level"]),
      since_error(where, id, criterion["since"]),
      url_error(where, criterion["url"], [@criterion_url_prefix], @fragment)
    ]
    |> Enum.reject(&is_nil/1)
    |> Kernel.++(text_errors(where, criterion, ~w(title summary who_is_affected)))
  end

  defp level_error(where, id, _level) when id in @removed_in_22,
    do: "#{where}: removido na WCAG 2.2, fica fora do catálogo"

  defp level_error(where, id, level) do
    case Map.fetch(@required_levels, id) do
      {:ok, ^level} -> nil
      {:ok, expected} -> "#{where}: nível #{level}, mas na WCAG 2.2 ele é #{expected}"
      :error when level == "AAA" -> nil
      :error -> "#{where}: nível #{level}, mas não é um dos 55 critérios A e AA da WCAG 2.2"
    end
  end

  defp since_error(where, id, since) do
    in_wcag20 = MapSet.member?(@wcag20_set, id)

    cond do
      in_wcag20 and since != "2.0" -> "#{where}: existe desde a WCAG 2.0, mas since é #{since}"
      not in_wcag20 and since == "2.0" -> "#{where}: since é 2.0, mas não existe na WCAG 2.0"
      true -> nil
    end
  end

  # Recomendações do eMAG

  defp emag_errors(%{"url" => url, "recommendations" => recommendations}) do
    ids = Enum.map(recommendations, & &1["id"])
    present = MapSet.new(ids)
    missing = Enum.reject(@emag_ids, &MapSet.member?(present, &1))
    unknown = ids |> Enum.reject(&(&1 in @emag_ids)) |> Enum.uniq()

    [
      url_error("emag-3.1.pt-BR.json", url, @emag_url_prefixes, @url_path),
      if(missing != [],
        do: "emag-3.1.pt-BR.json: faltam recomendações: #{Enum.join(sort_ids(missing), ", ")}"
      ),
      if(unknown != [],
        do:
          "emag-3.1.pt-BR.json: recomendações que não existem no eMAG 3.1: " <>
            Enum.join(sort_ids(unknown), ", ")
      )
    ]
    |> Enum.reject(&is_nil/1)
    |> Kernel.++(duplicates(ids, &"emag-3.1.pt-BR.json: recomendação #{&1} repetida"))
    |> Kernel.++(Enum.flat_map(recommendations, &recommendation_errors/1))
  end

  defp recommendation_errors(%{"id" => id, "section" => section, "wcag20" => cited} = rec) do
    where = "emag-3.1.pt-BR.json: recomendação #{id}"
    [prefix | _] = String.split(id, ".")

    section_error =
      case Map.fetch(@emag_sections, prefix) do
        {:ok, {^section, _count}} -> []
        {:ok, {expected, _count}} -> ["#{where}: seção #{section}, mas é da seção #{expected}"]
        :error -> []
      end

    citation_errors =
      for criterion <- cited, not MapSet.member?(@wcag20_set, criterion) do
        "#{where}: cita #{criterion}, que não é critério da WCAG 2.0"
      end

    section_error ++ citation_errors ++ text_errors(where, rec, ["title"])
  end

  # Regras comuns

  # O resto do link, depois do prefixo, precisa casar com `rest` até o fim (`\z`: o `$` do
  # `pattern` do schema aceita uma quebra de linha no fim).
  defp url_error(where, url, prefixes, rest) do
    allowed? =
      Enum.any?(prefixes, fn prefix ->
        String.starts_with?(url, prefix) and
          Regex.match?(rest, String.replace_prefix(url, prefix, ""))
      end)

    if allowed?,
      do: nil,
      else:
        "#{where}: link fora dos sites oficiais (#{inspect(url)}); aceitos: " <>
          Enum.join(prefixes, ", ")
  end

  defp text_errors(where, item, fields) do
    Enum.flat_map(fields, fn field ->
      case text_problem(item[field]) do
        nil -> []
        problem -> ["#{where}: #{field} #{problem}"]
      end
    end)
  end

  defp text_problem(text) do
    cond do
      Regex.match?(@control_chars, text) -> "tem caractere de controle"
      String.trim(text) != text -> "tem espaço no começo ou no fim"
      true -> nil
    end
  end

  defp duplicates(ids, message) do
    for {id, count} <- Enum.frequencies(ids), count > 1, do: message.(id)
  end

  defp sort_ids(ids), do: Enum.sort_by(ids, &sort_key/1)

  # Catálogo derivado

  defp derive(criteria, %{"url" => emag_url, "recommendations" => recommendations}) do
    catalog_ids = MapSet.new(criteria, & &1["id"])

    citing =
      for %{"id" => rec_id, "title" => title, "wcag20" => cited} <- recommendations,
          criterion <- cited,
          MapSet.member?(catalog_ids, criterion),
          reduce: %{} do
        acc -> Map.update(acc, criterion, [{rec_id, title}], &[{rec_id, title} | &1])
      end

    data =
      criteria
      |> Enum.sort_by(&sort_key(&1["id"]))
      |> Enum.map(fn criterion ->
        emag =
          citing
          |> Map.get(criterion["id"], [])
          |> Enum.sort_by(fn {rec_id, _title} -> sort_key(rec_id) end)
          |> Enum.map(fn {rec_id, title} -> %{id: rec_id, title: title} end)

        %{
          id: criterion["id"],
          level: criterion["level"],
          since: criterion["since"],
          title: criterion["title"],
          summary: criterion["summary"],
          who_is_affected: criterion["who_is_affected"],
          url: criterion["url"],
          emag: emag
        }
      end)

    sources = %{
      wcag: @wcag_source,
      emag: %{name: @emag_source_name, url: emag_url, license: @emag_source_license}
    }

    version = content_version(sources, data)

    %{
      criteria: data,
      sources: sources,
      content_version: version,
      body: encode(sources, data, version)
    }
  end
end
