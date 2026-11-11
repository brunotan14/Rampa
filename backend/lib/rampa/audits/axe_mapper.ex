defmodule Rampa.Audits.AxeMapper do
  @moduledoc """
  Converte o resultado do axe devolvido pelo scanner (campo `axe` do contrato, PRD §7) em
  atributos de achado (RF-RA003). Módulo puro: não acessa banco nem rede. Espera os dados
  já saneados por `Rampa.Audits.PageData.sanitize/1` (sem NUL).

  Regras da conversão:

    * um achado por **nó** do axe (cada elemento afetado é um achado);
    * `violations` viram `source: :axe`, `needs_review: false`; `incomplete` (o axe não
      conseguiu decidir) viram `source: :axe`, `needs_review: true`; `confidence` fica nulo;
    * `severity` é o `impact` do nó; se faltar, o `impact` da regra; se também faltar (o axe
      pode devolver `null`, sobretudo em `incomplete`), `:moderate`, o nível do meio, para
      o achado não sumir nem ganhar peso que o axe não deu;
    * `wcag_criteria` sai das tags no formato `wcag<princípio><diretriz><critério>`
      (`wcag111` → `"1.1.1"`, `wcag1410` → `"1.4.10"`). Tags de nível (`wcag2a`, `wcag21aa`),
      `best-practice` e as de outras normas são ignoradas;
    * `selector` vem do `target` do axe, que é uma lista com um item por nível de iframe
      (do documento principal para dentro). Um item que também é lista indica shadow DOM
      (do host para dentro). Os níveis de iframe são unidos por `" >>> "` e os de shadow DOM
      por `" >> "`: `[["#host", "button"]]` vira `"#host >> button"` e
      `["iframe#a", "p"]` vira `"iframe#a >>> p"`. Nó com `target_truncated` (o scanner
      cortou o `target` nos limites do contrato) fica com `selector` nulo: um seletor cortado
      não aponta com segurança para o elemento, e o `html_snippet` continua ajudando a
      encontrá-lo;
    * `html_snippet` é o `html` do nó cortado em no máximo 2048 bytes, sem quebrar um
      caractere UTF-8 no meio (RNF-RA005);
    * `message` é o `failureSummary` do nó; se faltar, o `help` da regra. O texto em PT-BR
      entra no M3;
    * `raw` guarda só `id`, `tags`, `help`, `helpUrl`, `impact` e `nodes_total` da regra, sem
      HTML. `nodes_total` é quantos nós a regra tinha antes de o scanner cortar a lista
      (contrato do scanner): a página pode ter mais ocorrências do que achados gravados.

  A versão do axe não vai no achado: fica em `pages.axe_version` (RNF-RA006).
  """

  alias Rampa.Audits.{Finding, PageData}

  @severities %{
    "critical" => :critical,
    "serious" => :serious,
    "moderate" => :moderate,
    "minor" => :minor
  }

  @default_severity :moderate

  @wcag_tag ~r/^wcag(\d)(\d)(\d+)$/

  @frame_separator " >>> "
  @shadow_separator " >> "

  @type attrs :: %{
          source: :axe,
          rule_id: String.t(),
          wcag_criteria: [String.t()],
          severity: Finding.severity(),
          needs_review: boolean(),
          confidence: nil,
          selector: String.t() | nil,
          html_snippet: String.t() | nil,
          message: String.t() | nil,
          raw: map()
        }

  @doc "Atributos de achado (sem `page_id` e `audit_id`) para o mapa `axe` do scanner."
  @spec to_findings(map()) :: [attrs()]
  def to_findings(axe) when is_map(axe) do
    rules(axe, "violations", false) ++ rules(axe, "incomplete", true)
  end

  defp rules(axe, key, needs_review) do
    for rule <- List.wrap(axe[key]),
        is_map(rule),
        node <- List.wrap(rule["nodes"]),
        is_map(node) do
      to_finding(rule, node, needs_review)
    end
  end

  defp to_finding(rule, node, needs_review) do
    %{
      source: :axe,
      rule_id: rule["id"],
      wcag_criteria: wcag_criteria(rule["tags"]),
      severity: severity(node["impact"], rule["impact"]),
      needs_review: needs_review,
      confidence: nil,
      selector: if(node["target_truncated"] == true, do: nil, else: selector(node["target"])),
      html_snippet: PageData.truncate_bytes(node["html"], Finding.html_snippet_max_bytes()),
      message: node["failureSummary"] || rule["help"],
      raw: Map.take(rule, ["id", "tags", "help", "helpUrl", "impact", "nodes_total"])
    }
  end

  @doc "Severidade do nó, senão a da regra, senão `:moderate`."
  @spec severity(String.t() | nil, String.t() | nil) :: Finding.severity()
  def severity(node_impact, rule_impact) do
    Map.get(@severities, node_impact) || Map.get(@severities, rule_impact) || @default_severity
  end

  @doc "Critérios WCAG (`\"1.1.1\"`) a partir das tags do axe, na ordem em que aparecem."
  @spec wcag_criteria([String.t()] | nil) :: [String.t()]
  def wcag_criteria(tags) do
    tags
    |> List.wrap()
    |> Enum.flat_map(fn tag ->
      case is_binary(tag) && Regex.run(@wcag_tag, tag, capture: :all_but_first) do
        [principle, guideline, criterion] -> ["#{principle}.#{guideline}.#{criterion}"]
        _ -> []
      end
    end)
    |> Enum.uniq()
  end

  @doc "Seletor em texto a partir do `target` do axe (ver o moduledoc)."
  @spec selector(list() | nil) :: String.t() | nil
  def selector(target) when is_list(target) and target != [] do
    Enum.map_join(target, @frame_separator, fn
      shadow when is_list(shadow) -> Enum.join(shadow, @shadow_separator)
      selector -> to_string(selector)
    end)
  end

  def selector(_target), do: nil
end
