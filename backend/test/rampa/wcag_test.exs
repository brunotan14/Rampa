defmodule Rampa.WcagTest do
  @moduledoc """
  Catálogo dos critérios WCAG (RF-RA007, `specs/002-criterios-wcag-emag`). O conteúdo
  compilado é conferido contra listas escritas aqui, independentes do módulo; a validação da
  compilação é testada chamando `Rampa.Wcag.Catalog.build/2` com dados inválidos.
  """

  use ExUnit.Case, async: true

  alias Rampa.Wcag
  alias Rampa.Wcag.Catalog

  # Research R1: os 55 critérios A e AA da WCAG 2.2.
  @level_a ~w(1.1.1 1.2.1 1.2.2 1.2.3 1.3.1 1.3.2 1.3.3 1.4.1 1.4.2 2.1.1 2.1.2 2.1.4 2.2.1
              2.2.2 2.3.1 2.4.1 2.4.2 2.4.3 2.4.4 2.5.1 2.5.2 2.5.3 2.5.4 3.1.1 3.2.1 3.2.2
              3.2.6 3.3.1 3.3.2 3.3.7 4.1.2)
  @level_aa ~w(1.2.4 1.2.5 1.3.4 1.3.5 1.4.3 1.4.4 1.4.5 1.4.10 1.4.11 1.4.12 1.4.13 2.4.5
               2.4.6 2.4.7 2.4.11 2.5.7 2.5.8 3.1.2 3.2.3 3.2.4 3.3.3 3.3.4 3.3.8 4.1.3)
  # AAA citados pelas regras do axe que o Rampa roda (research R1, revisão B1).
  @level_aaa ~w(2.1.3)

  # CA2.4 / SC-005: o Rampa não certifica conformidade. Mesma intenção do teste de textos do
  # frontend (`frontend/src/i18n/i18n.test.ts`), mais as palavras do SC-005.
  @forbidden ~r/\b(conformidade|conformes?|cumprem?|certificad\w*)\b|(está|estão|é|são) acessíve(l|is)|site acessível|página acessível|100% acessível/iu

  # Exceções explícitas ao teste acima, como `{id, campo}`, cada uma com o motivo num
  # comentário. Vazia: nenhum texto precisa das palavras proibidas.
  @forbidden_exceptions []

  @text_fields [:summary, :who_is_affected]

  defp docs do
    {Catalog.read!(Path.join(Catalog.dir(), "criteria.pt-BR.json")),
     Catalog.read!(Path.join(Catalog.dir(), "emag-3.1.pt-BR.json"))}
  end

  defp update_criterion(criteria_doc, id, fun),
    do: update_in(criteria_doc["criteria"], &update_item(&1, id, fun))

  defp update_recommendation(emag_doc, id, fun),
    do: update_in(emag_doc["recommendations"], &update_item(&1, id, fun))

  defp update_item(items, id, fun),
    do: Enum.map(items, fn item -> if item["id"] == id, do: fun.(item), else: item end)

  defp build_errors(criteria_doc, emag_doc) do
    assert {:error, errors} = Catalog.build(criteria_doc, emag_doc)
    Enum.join(errors, "\n")
  end

  defp emag_ids(id) do
    {:ok, criterion} = Wcag.get(id)
    Enum.map(criterion.emag, & &1.id)
  end

  describe "conteúdo compilado" do
    test "SC-001: os 55 critérios A e AA da WCAG 2.2 e o 2.1.3 (AAA), com todos os campos" do
      expected =
        Map.new(@level_a, &{&1, "A"})
        |> Map.merge(Map.new(@level_aa, &{&1, "AA"}))
        |> Map.merge(Map.new(@level_aaa, &{&1, "AAA"}))

      assert length(@level_a) == 31
      assert length(@level_aa) == 24
      assert Map.new(Wcag.all(), &{&1.id, &1.level}) == expected
      assert length(Wcag.all()) == 56

      for criterion <- Wcag.all(),
          field <- [:id, :level, :since, :title, :summary, :who_is_affected, :url] do
        value = Map.fetch!(criterion, field)
        assert is_binary(value) and String.trim(value) != "", "#{criterion.id} sem #{field}"
      end
    end

    test "SC-001: o módulo exige exatamente os 55 de research R1" do
      assert Catalog.required_levels() ==
               Map.merge(Map.new(@level_a, &{&1, "A"}), Map.new(@level_aa, &{&1, "AA"}))
    end

    test "T018 (FR-006): nenhum texto provisório marcado com [rascunho]" do
      drafts =
        for criterion <- Wcag.all(),
            field <- [:title | @text_fields],
            String.contains?(Map.fetch!(criterion, field), "[rascunho]"),
            do: "#{criterion.id}.#{field}"

      assert drafts == []
    end

    test "CA1.5: critério fora do catálogo é :error, sem quebrar" do
      for id <- ["4.1.1", "2.4.10", "9.9.9", "", "1.1.1 "] do
        assert Wcag.get(id) == :error
        refute Wcag.known?(id)
      end

      for id <- [nil, 111, :"1.1.1", ["1.1.1"]] do
        assert Wcag.get(id) == :error
        refute Wcag.known?(id)
      end

      assert {:ok, %{id: "1.1.1"}} = Wcag.get("1.1.1")
      assert Wcag.known?("1.1.1")
    end

    test "CA1.6: o 2.1.3 da regra de região rolável é AAA, ao lado do 2.1.1" do
      assert {:ok, %{level: "AAA", since: "2.0", title: "Teclado (Sem Exceção)"}} =
               Wcag.get("2.1.3")

      assert {:ok, %{level: "A", title: "Teclado"}} = Wcag.get("2.1.1")
    end

    test "CA1.1: 1.1.1 com nível, título da tradução autorizada e link da W3C em português" do
      assert {:ok, criterion} = Wcag.get("1.1.1")
      assert criterion.level == "A"
      assert criterion.title == "Conteúdo Não Textual"
      assert criterion.url == "https://www.w3.org/Translations/WCAG22-pt-BR/#non-text-content"
    end

    test "CA3.1: 1.1.1 é citado pela recomendação 3.6 do eMAG" do
      assert {:ok, criterion} = Wcag.get("1.1.1")

      assert %{id: "3.6", title: "Fornecer alternativa em texto para as imagens do sítio"} in criterion.emag

      assert emag_ids("1.1.1") == ["3.6", "3.7", "6.1", "6.8"]
    end

    test "CA3.2: critério da 2.1 ou 2.2 e critério da 2.0 sem citação têm eMAG vazio" do
      assert {:ok, %{since: "2.2", emag: []}} = Wcag.get("2.5.8")
      assert {:ok, %{since: "2.1", emag: []}} = Wcag.get("1.4.10")
      assert {:ok, %{since: "2.0", emag: []}} = Wcag.get("1.4.5")
    end

    test "CA3.3 (S6): recomendações e critérios em ordem numérica por componente" do
      assert emag_ids("1.3.1") == ~w(1.2 1.3 1.6 1.7 3.9 3.10 6.2 6.7)

      ids = Enum.map(Wcag.all(), & &1.id)
      assert ids == Enum.sort_by(ids, &Catalog.sort_key/1)

      assert Enum.find_index(ids, &(&1 == "1.4.5")) <
               Enum.find_index(ids, &(&1 == "1.4.10"))

      for criterion <- Wcag.all() do
        refs = Enum.map(criterion.emag, & &1.id)
        assert refs == Enum.sort_by(refs, &Catalog.sort_key/1), "eMAG de #{criterion.id}"
      end
    end

    test "CA3.3 (S6): a ordem numérica não depende da ordem dos arquivos" do
      {criteria_doc, emag_doc} = docs()
      shuffled_criteria = update_in(criteria_doc["criteria"], &Enum.reverse/1)
      shuffled_emag = update_in(emag_doc["recommendations"], &Enum.reverse/1)

      assert {:ok, catalog} = Catalog.build(shuffled_criteria, shuffled_emag)
      assert Enum.map(catalog.criteria, & &1.id) == Enum.map(Wcag.all(), & &1.id)

      assert Enum.find(catalog.criteria, &(&1.id == "1.3.1")).emag |> Enum.map(& &1.id) ==
               ~w(1.2 1.3 1.6 1.7 3.9 3.10 6.2 6.7)

      assert catalog.body == Wcag.body()
    end

    test "SC-002: toda citação do eMAG é critério da WCAG 2.0, inclusive as AAA e o 4.1.1" do
      {_criteria_doc, emag_doc} = docs()

      assert length(Catalog.wcag20()) == 61
      assert length(Enum.uniq(Catalog.wcag20())) == 61

      cited = for rec <- emag_doc["recommendations"], id <- rec["wcag20"], do: id
      assert Enum.reject(cited, &(&1 in Catalog.wcag20())) == []

      # As citações fora do catálogo ficam guardadas no arquivo e a inversão as ignora.
      assert "4.1.1" in cited
      assert "2.4.10" in cited
      refute Wcag.known?("2.4.10")
      assert emag_ids("4.1.2") |> Enum.member?("1.1")
    end

    test "SC-002: a correspondência é exatamente a inversão das citações do arquivo" do
      {_criteria_doc, emag_doc} = docs()

      for criterion <- Wcag.all() do
        expected =
          for rec <- emag_doc["recommendations"],
              criterion.id in rec["wcag20"],
              do: rec["id"]

        assert Enum.sort(Enum.map(criterion.emag, & &1.id)) == Enum.sort(expected),
               "eMAG de #{criterion.id}"
      end
    end

    test "SC-002: arquivo com citação AAA fora do catálogo compila e a inversão a ignora" do
      {criteria_doc, emag_doc} = docs()

      emag_doc =
        update_recommendation(emag_doc, "3.6", &Map.put(&1, "wcag20", ["1.1.1", "1.4.6"]))

      assert {:ok, catalog} = Catalog.build(criteria_doc, emag_doc)
      refute Enum.any?(catalog.criteria, &(&1.id == "1.4.6"))
      assert Enum.find(catalog.criteria, &(&1.id == "1.1.1")).emag |> Enum.any?(&(&1.id == "3.6"))
    end

    test "FR-005: links só dos sites oficiais" do
      for criterion <- Wcag.all() do
        assert String.starts_with?(
                 criterion.url,
                 "https://www.w3.org/Translations/WCAG22-pt-BR/#"
               ),
               criterion.url
      end

      assert Wcag.sources().wcag.url == "https://www.w3.org/Translations/WCAG22-pt-BR-20250327/"
      assert Wcag.sources().emag.url == "https://emag.governoeletronico.gov.br/"
    end

    test "CA2.4 / SC-005: summary e who_is_affected sem afirmar conformidade" do
      offenders =
        for criterion <- Wcag.all(),
            field <- @text_fields,
            {criterion.id, field} not in @forbidden_exceptions,
            Regex.match?(@forbidden, Map.fetch!(criterion, field)),
            do: {criterion.id, field, Map.fetch!(criterion, field)}

      assert offenders == []
    end

    test "CA2.4 / SC-005: a lista de palavras proibidas pega o que deve pegar" do
      for text <- [
            "O site está conforme.",
            "Garante a conformidade com a WCAG.",
            "Quem cumpre o critério.",
            "A página não cumpre o critério.",
            "Os sites que cumprem.",
            "O site é acessível.",
            "Página certificada."
          ] do
        assert Regex.match?(@forbidden, text), text
      end

      refute Regex.match?(@forbidden, "Pessoas com baixa visão não leem o texto.")
    end

    test "I7: content_version tem 12 hex e é derivado do catálogo servido" do
      assert Wcag.content_version() =~ ~r/^[0-9a-f]{12}$/
      assert Wcag.content_version() == Catalog.content_version(Wcag.sources(), Wcag.all())

      {criteria_doc, emag_doc} = docs()
      assert {:ok, again} = Catalog.build(criteria_doc, emag_doc)
      assert again.content_version == Wcag.content_version()
      assert again.body == Wcag.body()
    end

    test "I7: content_version muda quando a derivação muda" do
      {criteria_doc, emag_doc} = docs()

      changed_text = update_criterion(criteria_doc, "1.4.3", &Map.put(&1, "summary", "Outro."))

      changed_citation =
        update_recommendation(emag_doc, "4.1", &Map.put(&1, "wcag20", ["1.4.3", "1.4.4"]))

      changed_url = Map.put(emag_doc, "url", "https://www.gov.br/governodigital/emag")

      versions =
        for {c, e} <- [
              {changed_text, emag_doc},
              {criteria_doc, changed_citation},
              {criteria_doc, changed_url}
            ] do
          assert {:ok, %{content_version: version}} = Catalog.build(c, e)
          version
        end

      assert length(Enum.uniq([Wcag.content_version() | versions])) == 4
    end

    test "FR-014: o corpo pré-codificado traz content_version, sources e os critérios" do
      body = Jason.decode!(Wcag.body())

      assert body["content_version"] == Wcag.content_version()

      assert body["sources"] == %{
               "wcag" => %{
                 "name" =>
                   "WCAG 2.2, Tradução Autorizada para o português do Brasil (W3C, 27/03/2025)",
                 "url" => "https://www.w3.org/Translations/WCAG22-pt-BR-20250327/",
                 "license" => "W3C Document License"
               },
               "emag" => %{
                 "name" => "Modelo de Acessibilidade em Governo Eletrônico (eMAG) 3.1",
                 "url" => "https://emag.governoeletronico.gov.br/",
                 "license" => "CC BY 4.0"
               }
             }

      assert body["data"] == Wcag.all() |> Jason.encode!() |> Jason.decode!()
    end

    test "I7: chaves na ordem do contrato, sem depender da ordem interna dos mapas" do
      ordered = Jason.decode!(Wcag.body(), objects: :ordered_objects)
      keys = fn object -> Enum.map(object.values, &elem(&1, 0)) end

      assert keys.(ordered) == ~w(content_version sources data)
      assert keys.(ordered["sources"]) == ~w(wcag emag)
      assert keys.(ordered["sources"]["wcag"]) == ~w(name url license)

      for criterion <- ordered["data"] do
        assert keys.(criterion) == ~w(id level since title summary who_is_affected url emag)
        for ref <- criterion["emag"], do: assert(keys.(ref) == ~w(id title))
      end
    end
  end

  describe "validação da compilação (Catalog.build/2)" do
    test "os arquivos reais passam" do
      {criteria_doc, emag_doc} = docs()
      assert {:ok, %{criteria: criteria}} = Catalog.build(criteria_doc, emag_doc)
      assert length(criteria) == 56
    end

    test "fora do schema: documento que não é objeto, campo faltando, nível inválido" do
      {criteria_doc, emag_doc} = docs()

      assert {:error, [_ | _]} = Catalog.build(nil, emag_doc)
      assert {:error, [_ | _]} = Catalog.build(criteria_doc, [])

      no_title = update_criterion(criteria_doc, "1.1.1", &Map.delete(&1, "title"))
      assert build_errors(no_title, emag_doc) =~ "criteria.pt-BR.json"

      bad_level = update_criterion(criteria_doc, "1.1.1", &Map.put(&1, "level", "AAAA"))
      assert build_errors(bad_level, emag_doc) =~ "criteria.pt-BR.json #/criteria/0/level"

      extra = update_criterion(criteria_doc, "1.1.1", &Map.put(&1, "extra", "x"))
      assert build_errors(extra, emag_doc) =~ "criteria.pt-BR.json"

      long =
        update_criterion(
          criteria_doc,
          "1.1.1",
          &Map.put(&1, "summary", String.duplicate("a", 401))
        )

      assert build_errors(long, emag_doc) =~ "summary"
    end

    test "SC-001: id repetido" do
      {criteria_doc, emag_doc} = docs()
      [first | _] = criteria_doc["criteria"]
      dup = update_in(criteria_doc["criteria"], &(&1 ++ [first]))

      assert build_errors(dup, emag_doc) =~ "critério 1.1.1 repetido"
    end

    test "SC-001: critério A/AA faltando" do
      {criteria_doc, emag_doc} = docs()

      missing =
        update_in(criteria_doc["criteria"], fn c ->
          Enum.reject(c, &(&1["id"] in ["1.4.10", "2.5.8"]))
        end)

      assert build_errors(missing, emag_doc) =~
               "faltam critérios A/AA da WCAG 2.2: 1.4.10, 2.5.8"
    end

    test "SC-001: nível diferente do da WCAG 2.2 e A/AA fora da lista" do
      {criteria_doc, emag_doc} = docs()

      wrong = update_criterion(criteria_doc, "1.4.3", &Map.put(&1, "level", "A"))
      assert build_errors(wrong, emag_doc) =~ "critério 1.4.3: nível A, mas na WCAG 2.2 ele é AA"

      extra =
        update_in(
          criteria_doc["criteria"],
          &(&1 ++
              [
                %{
                  "id" => "1.4.6",
                  "level" => "AA",
                  "since" => "2.0",
                  "title" => "Contraste (Melhorado)",
                  "summary" => "Resumo.",
                  "who_is_affected" => "Pessoas.",
                  "url" => "https://www.w3.org/Translations/WCAG22-pt-BR/#contrast-enhanced"
                }
              ])
        )

      assert build_errors(extra, emag_doc) =~ "critério 1.4.6: nível AA, mas não é um dos 55"

      aaa = update_criterion(extra, "1.4.6", &Map.put(&1, "level", "AAA"))
      assert {:ok, %{criteria: criteria}} = Catalog.build(aaa, emag_doc)
      assert Enum.any?(criteria, &(&1.id == "1.4.6" and &1.level == "AAA"))
    end

    test "CA1.5: o 4.1.1, removido na WCAG 2.2, não entra" do
      {criteria_doc, emag_doc} = docs()

      removed =
        update_in(
          criteria_doc["criteria"],
          &(&1 ++
              [
                %{
                  "id" => "4.1.1",
                  "level" => "AAA",
                  "since" => "2.0",
                  "title" => "Análise",
                  "summary" => "Resumo.",
                  "who_is_affected" => "Pessoas.",
                  "url" => "https://www.w3.org/Translations/WCAG22-pt-BR/#parsing"
                }
              ])
        )

      assert build_errors(removed, emag_doc) =~ "critério 4.1.1: removido na WCAG 2.2"
    end

    test "CA3.2: since precisa bater com a WCAG 2.0" do
      {criteria_doc, emag_doc} = docs()

      old = update_criterion(criteria_doc, "1.1.1", &Map.put(&1, "since", "2.1"))
      assert build_errors(old, emag_doc) =~ "critério 1.1.1: existe desde a WCAG 2.0"

      new = update_criterion(criteria_doc, "2.5.8", &Map.put(&1, "since", "2.0"))
      assert build_errors(new, emag_doc) =~ "critério 2.5.8: since é 2.0"
    end

    test "FR-005: link fora dos sites oficiais" do
      {criteria_doc, emag_doc} = docs()

      for url <- [
            "https://example.com/#non-text-content",
            "https://www.w3.org.example.com/Translations/WCAG22-pt-BR/#non-text-content",
            "http://www.w3.org/Translations/WCAG22-pt-BR/#non-text-content",
            "https://www.w3.org/TR/WCAG22/#non-text-content",
            "https://www.w3.org/Translations/WCAG22-pt-BR/#"
          ] do
        bad = update_criterion(criteria_doc, "1.1.1", &Map.put(&1, "url", url))
        assert {:error, _} = Catalog.build(bad, emag_doc), url
      end

      assert build_errors(
               update_criterion(
                 criteria_doc,
                 "1.1.1",
                 &Map.put(&1, "url", "https://www.w3.org/Translations/WCAG22-pt-BR/#a\n")
               ),
               emag_doc
             ) =~ "criteria.pt-BR.json"

      for url <- [
            "https://emag.governoeletronico.gov.br.example.com/",
            "https://example.com/emag",
            "http://emag.governoeletronico.gov.br/",
            "https://www.gov.br/outro/emag"
          ] do
        assert {:error, _} = Catalog.build(criteria_doc, Map.put(emag_doc, "url", url)), url
      end

      assert {:ok, _} =
               Catalog.build(
                 criteria_doc,
                 Map.put(emag_doc, "url", "https://www.gov.br/governodigital/pt-br/emag")
               )
    end

    test "SC-002: citação que não é critério da WCAG 2.0" do
      {criteria_doc, emag_doc} = docs()

      for id <- ["2.5.8", "1.3.4", "1.9.9"] do
        bad = update_recommendation(emag_doc, "3.6", &Map.put(&1, "wcag20", ["1.1.1", id]))

        assert build_errors(criteria_doc, bad) =~
                 "recomendação 3.6: cita #{id}, que não é critério da WCAG 2.0"
      end

      repeated =
        update_recommendation(emag_doc, "3.6", &Map.put(&1, "wcag20", ["1.1.1", "1.1.1"]))

      assert build_errors(criteria_doc, repeated) =~ "emag-3.1.pt-BR.json"
    end

    test "eMAG: recomendação faltando, repetida, inexistente ou na seção errada" do
      {criteria_doc, emag_doc} = docs()
      recs = emag_doc["recommendations"]
      [first | rest] = recs

      replaced = %{emag_doc | "recommendations" => rest ++ [%{first | "id" => "1.10"}]}
      errors = build_errors(criteria_doc, replaced)
      assert errors =~ "faltam recomendações: 1.1"
      assert errors =~ "recomendações que não existem no eMAG 3.1: 1.10"

      duplicated = %{emag_doc | "recommendations" => rest ++ [Enum.at(rest, 0)]}
      assert build_errors(criteria_doc, duplicated) =~ "recomendação 1.2 repetida"

      wrong_section = update_recommendation(emag_doc, "3.6", &Map.put(&1, "section", "Marcação"))

      assert build_errors(criteria_doc, wrong_section) =~
               "recomendação 3.6: seção Marcação, mas é da seção Conteúdo/Informação"
    end

    test "texto com caractere de controle ou espaço nas pontas" do
      {criteria_doc, emag_doc} = docs()

      nul = update_criterion(criteria_doc, "1.1.1", &Map.put(&1, "summary", "Resumo\u0000."))
      assert build_errors(nul, emag_doc) =~ "critério 1.1.1: summary tem caractere de controle"

      padded = update_criterion(criteria_doc, "1.1.1", &Map.put(&1, "title", " Título"))
      assert build_errors(padded, emag_doc) =~ "critério 1.1.1: title tem espaço no começo"

      rec = update_recommendation(emag_doc, "3.6", &Map.put(&1, "title", "Título\n"))

      assert build_errors(criteria_doc, rec) =~
               "recomendação 3.6: title tem caractere de controle"
    end

    test "acumula todos os problemas numa só mensagem" do
      {criteria_doc, emag_doc} = docs()

      bad =
        criteria_doc
        |> update_criterion("1.4.3", &Map.put(&1, "level", "A"))
        |> update_criterion("2.5.8", &Map.put(&1, "since", "2.0"))

      bad_emag = update_recommendation(emag_doc, "3.6", &Map.put(&1, "wcag20", ["2.5.8"]))

      assert {:error, errors} = Catalog.build(bad, bad_emag)
      assert length(errors) == 3
    end
  end
end
