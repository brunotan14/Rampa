defmodule Rampa.Audits.Report do
  @moduledoc """
  Leituras do relatório (RF-RA005 a RF-RA007, RF-RA017), expostas por `Rampa.Audits`. Só
  lê: nenhuma trava, nenhuma escrita.

  ## Capacidade

  O id da auditoria é o link (RF-RA014): toda leitura de página ou achado filtra por `id`
  **e** `audit_id` no próprio `WHERE`. Página ou achado de outra auditoria não é encontrado,
  com a mesma resposta de um inexistente. UUID inválido também.

  ## Ocorrências

  `rule_occurrences/2` é a única contagem de ocorrências por regra: agrupa por
  `(page_id, rule_id, needs_review)` e, em cada grupo, vale o maior entre o número de
  achados gravados e o `nodes_total` do axe (o scanner manda no máximo 20 nós por regra, e a
  página pode ter mais). `needs_review` separa as listas do axe: `color-contrast` em
  `violations` e em `incomplete` na mesma página são dois grupos, e cada um conta só os
  próprios achados. O top 5 do resumo, o detalhe de um achado e o "onde mais aparece" saem
  dela.

  ## Resumo numa instrução

  `summary/1` lê a auditoria (com a `revision`), os totais por severidade (confirmados e a
  revisar) e o top 5 numa instrução SQL só, como o snapshot do canal: no `READ COMMITTED`, uma
  instrução enxerga um único instante, então nada do resumo vem de um commit diferente.
  """

  import Ecto.Query

  alias Rampa.Audits.{Audit, Finding, Page}
  alias Rampa.Repo

  @top_issues_limit 5

  # Teto do `nodes_total` lido do `raw`: um número absurdo não derruba a consulta. Sem
  # `nodes_total` (achado de IA, `raw` sem o campo), vale a contagem dos achados: o
  # `coalesce` vem antes do `LEAST`, que ignoraria o `NULL` e devolveria o teto.
  @nodes_total_cap 1_000_000

  # Campos da página nas listas (sem `passed_rules`, que pode ter até 64 KB).
  @page_summary_fields [
    :id,
    :audit_id,
    :url,
    :final_url,
    :title,
    :status,
    :http_status,
    :error,
    :axe_version,
    :scanned_at,
    :inserted_at
  ]

  @severities Finding.severities()

  @type severity_totals :: %{Finding.severity() => non_neg_integer()}

  @type top_issue :: %{
          rule_id: String.t(),
          help: String.t() | nil,
          wcag_criteria: [String.t()],
          severity: Finding.severity(),
          pages_affected: pos_integer(),
          occurrences: pos_integer(),
          sample_finding_id: Ecto.UUID.t()
        }

  @type summary :: %{
          audit: Audit.t(),
          totals_by_severity: severity_totals(),
          needs_review_by_severity: severity_totals(),
          needs_review_count: non_neg_integer(),
          top_issues: [top_issue()]
        }

  @type page_summary :: %{
          page: Page.t(),
          counts_by_severity: severity_totals(),
          needs_review_count: non_neg_integer(),
          passed_count: non_neg_integer() | nil
        }

  @type occurrence :: %{
          page_id: Ecto.UUID.t(),
          url: String.t(),
          title: String.t() | nil,
          occurrences: pos_integer()
        }

  @type finding_detail :: %{
          finding: Finding.t(),
          page: Page.t(),
          occurrences: %{page: non_neg_integer(), audit: non_neg_integer()},
          other_pages: [occurrence()]
        }

  ## Resumo (RF-RA005)

  @doc """
  Resumo da auditoria: a auditoria, os totais por severidade dos achados confirmados
  (`needs_review = false`) e dos que pedem revisão, e o top #{@top_issues_limit} das regras
  confirmadas, numa instrução só.

  Top #{@top_issues_limit}: regras com achados confirmados, por páginas afetadas
  (decrescente), severidade mais grave, ocorrências (decrescente) e `rule_id`. A severidade
  é a mais grave entre os achados da regra; `sample_finding_id` é o achado mais grave (o
  primeiro gravado no empate), para o link "Ver detalhes técnicos".
  """
  @spec summary(String.t()) :: {:ok, summary()} | {:error, :audit_not_found}
  def summary(id) do
    with {:ok, uuid} <- Ecto.UUID.cast(id),
         [{%Audit{} = audit, counts, _top} | _] = rows <- Repo.all(summary_query(uuid)) do
      top =
        for {_audit, _counts, %{issue: %{rule_id: rule_id}} = row} <- rows,
            rule_id != nil,
            do: top_issue(row)

      {confirmed, review} = split_review(counts)

      {:ok,
       %{
         audit: audit,
         totals_by_severity: confirmed,
         needs_review_by_severity: review,
         needs_review_count: review |> Map.values() |> Enum.sum(),
         top_issues: top
       }}
    else
      _not_found -> {:error, :audit_not_found}
    end
  end

  # A auditoria, os agregados (uma linha sempre) e o top 5 por `LEFT JOIN ... ON TRUE`: de 1 a
  # 5 linhas, todas com a mesma auditoria e os mesmos agregados. O achado de exemplo de cada
  # regra do top (com `help` e critérios) vem por `LATERAL`, depois do `LIMIT`: só para as 5
  # regras, e não para todos os grupos (página, regra, lista).
  defp summary_query(audit_id) do
    from a in Audit,
      cross_join: c in subquery(severity_counts(audit_id)),
      left_join: t in subquery(top_issues_query(audit_id)),
      as: :top,
      on: true,
      left_lateral_join: s in subquery(top_sample_query(audit_id)),
      on: true,
      where: a.id == ^audit_id,
      order_by: [
        desc: t.pages_affected,
        asc: t.severity_rank,
        desc: t.occurrences,
        asc: t.rule_id
      ],
      select: {a, c, %{issue: t, sample: s}}
  end

  # O achado confirmado mais grave da regra (o primeiro gravado no empate). Lê pelo índice
  # `(audit_id, rule_id, needs_review, page_id)`.
  defp top_sample_query(audit_id) do
    from f in Finding,
      where: f.audit_id == ^audit_id and not f.needs_review,
      where: f.rule_id == parent_as(:top).rule_id,
      order_by: [asc: f.severity_rank, asc: f.inserted_at, asc: f.id],
      limit: 1,
      select: %{
        id: f.id,
        help: fragment("coalesce(?->>'help', ?)", f.raw, f.message),
        wcag_criteria: f.wcag_criteria
      }
  end

  defp severity_counts(audit_id) do
    from f in Finding,
      where: f.audit_id == ^audit_id,
      select: %{
        critical: filter(count(f.id), f.severity == :critical and not f.needs_review),
        serious: filter(count(f.id), f.severity == :serious and not f.needs_review),
        moderate: filter(count(f.id), f.severity == :moderate and not f.needs_review),
        minor: filter(count(f.id), f.severity == :minor and not f.needs_review),
        review_critical: filter(count(f.id), f.severity == :critical and f.needs_review),
        review_serious: filter(count(f.id), f.severity == :serious and f.needs_review),
        review_moderate: filter(count(f.id), f.severity == :moderate and f.needs_review),
        review_minor: filter(count(f.id), f.severity == :minor and f.needs_review)
      }
  end

  defp split_review(counts) do
    confirmed = Map.new(@severities, &{&1, Map.fetch!(counts, &1)})
    review = Map.new(@severities, &{&1, Map.fetch!(counts, :"review_#{&1}")})
    {confirmed, review}
  end

  defp top_issues_query(audit_id) do
    from o in subquery(rule_occurrences(audit_id, needs_review: false)),
      group_by: o.rule_id,
      order_by: [
        desc: count(o.page_id),
        asc: min(o.severity_rank),
        desc: sum(o.occurrences),
        asc: o.rule_id
      ],
      limit: @top_issues_limit,
      select: %{
        rule_id: o.rule_id,
        pages_affected: count(o.page_id),
        occurrences: type(sum(o.occurrences), :integer),
        severity_rank: min(o.severity_rank)
      }
  end

  defp top_issue(%{issue: issue, sample: sample}) do
    %{
      rule_id: issue.rule_id,
      help: sample.help,
      wcag_criteria: sample.wcag_criteria || [],
      severity: Enum.at(@severities, issue.severity_rank),
      pages_affected: issue.pages_affected,
      occurrences: issue.occurrences,
      sample_finding_id: sample.id
    }
  end

  ## Ocorrências por regra

  @doc """
  Ocorrências por regra em cada página da auditoria, agrupadas por
  `(page_id, rule_id, needs_review)` (ver o moduledoc). Filtros opcionais: `:needs_review`
  (booleano) e `:rule_id`. Cada linha traz `occurrences` (o maior entre os achados e o
  `nodes_total`), `findings` e a severidade mais grave (`severity_rank`).

  Devolve uma consulta, para ser usada como subconsulta.
  """
  @spec rule_occurrences(Ecto.UUID.t(), keyword()) :: Ecto.Query.t()
  def rule_occurrences(audit_id, filters \\ []) do
    from(f in Finding,
      where: f.audit_id == ^audit_id,
      # Na ordem do índice `(audit_id, rule_id, needs_review, page_id)`.
      group_by: [f.rule_id, f.needs_review, f.page_id],
      select: %{
        page_id: f.page_id,
        rule_id: f.rule_id,
        needs_review: f.needs_review,
        findings: count(f.id),
        occurrences:
          type(
            fragment(
              "GREATEST(count(?), LEAST(coalesce(max((?->>'nodes_total')::numeric), 0), ?)::bigint)",
              f.id,
              f.raw,
              @nodes_total_cap
            ),
            :integer
          ),
        severity_rank: min(f.severity_rank)
      }
    )
    |> filter_occurrences(filters)
  end

  defp filter_occurrences(query, filters) do
    Enum.reduce(filters, query, fn
      {:needs_review, value}, query when is_boolean(value) ->
        where(query, [f], f.needs_review == ^value)

      {:rule_id, rule_id}, query when is_binary(rule_id) ->
        where(query, [f], f.rule_id == ^rule_id)
    end)
  end

  ## Páginas (RF-RA006, RF-RA017)

  @doc """
  Páginas da auditoria, na ordem em que entraram (`inserted_at`, `id`), com as contagens dos
  achados (confirmados por severidade e os que pedem revisão) e quantas regras aprovadas
  (`nil` quando não coletado). Numa instrução só. Sem paginação: uma auditoria tem no máximo
  25 páginas (`page_limit`, conferido no banco).
  """
  @spec list_pages(String.t()) :: {:ok, [page_summary()]} | {:error, :audit_not_found}
  def list_pages(audit_id) do
    with {:ok, uuid} <- Ecto.UUID.cast(audit_id),
         [_ | _] = rows <- Repo.all(pages_query(uuid)) do
      {:ok, for({%Page{} = page, counts, passed} <- rows, do: page_summary(page, counts, passed))}
    else
      _not_found -> {:error, :audit_not_found}
    end
  end

  # A auditoria com as páginas por `LEFT JOIN`: auditoria sem página dá uma linha com `nil`,
  # auditoria inexistente não dá linha.
  defp pages_query(audit_id) do
    from a in Audit,
      left_join: p in Page,
      on: p.audit_id == a.id,
      left_join: c in subquery(page_counts(audit_id)),
      on: c.page_id == p.id,
      where: a.id == ^audit_id,
      order_by: [asc: p.inserted_at, asc: p.id],
      select:
        {struct(p, ^@page_summary_fields), c, fragment("jsonb_array_length(?)", p.passed_rules)}
  end

  @doc """
  Uma página da auditoria, com as contagens e as regras aprovadas (`passed_rules`).
  Auditoria inexistente: `{:error, :audit_not_found}`; página que não é dela:
  `{:error, :page_not_found}`.
  """
  @spec get_page(String.t(), String.t()) ::
          {:ok, page_summary()} | {:error, :audit_not_found | :page_not_found}
  def get_page(audit_id, page_id) do
    with {:ok, audit_uuid} <- cast_or(audit_id, :audit_not_found),
         {:ok, page_uuid} <- cast_or(page_id, :page_not_found, audit_uuid) do
      query =
        from p in Page,
          left_join: c in subquery(page_counts(audit_uuid)),
          on: c.page_id == p.id,
          where: p.id == ^page_uuid and p.audit_id == ^audit_uuid,
          select: {p, c, fragment("jsonb_array_length(?)", p.passed_rules)}

      case Repo.one(query) do
        {page, counts, passed} -> {:ok, page_summary(page, counts, passed)}
        nil -> missing(audit_uuid, :page_not_found)
      end
    end
  end

  defp page_counts(audit_id) do
    from f in Finding,
      where: f.audit_id == ^audit_id,
      group_by: f.page_id,
      select: %{
        page_id: f.page_id,
        critical: filter(count(f.id), f.severity == :critical and not f.needs_review),
        serious: filter(count(f.id), f.severity == :serious and not f.needs_review),
        moderate: filter(count(f.id), f.severity == :moderate and not f.needs_review),
        minor: filter(count(f.id), f.severity == :minor and not f.needs_review),
        needs_review: filter(count(f.id), f.needs_review)
      }
  end

  defp page_summary(%Page{} = page, counts, passed) do
    counts = counts || %{}

    %{
      page: page,
      counts_by_severity: Map.new(@severities, &{&1, Map.get(counts, &1) || 0}),
      needs_review_count: Map.get(counts, :needs_review) || 0,
      passed_count: passed
    }
  end

  ## Detalhe de um achado (RF-RA007)

  @doc """
  Um achado da auditoria, com a página, as ocorrências da regra (nesta página e na auditoria,
  na mesma lista do axe: o `needs_review` do achado) e as outras páginas em que ela aparece,
  da que tem mais ocorrências para a que tem menos.

  Auditoria inexistente: `{:error, :audit_not_found}`; achado que não é dela:
  `{:error, :finding_not_found}`. O achado e as ocorrências são lidos em duas instruções:
  durante a auditoria, uma nova varredura da página no meio pode deixar as contagens de um
  instante seguinte (nunca quebra a resposta).
  """
  @spec get_finding(String.t(), String.t()) ::
          {:ok, finding_detail()} | {:error, :audit_not_found | :finding_not_found}
  def get_finding(audit_id, finding_id) do
    with {:ok, audit_uuid} <- cast_or(audit_id, :audit_not_found),
         {:ok, finding_uuid} <- cast_or(finding_id, :finding_not_found, audit_uuid) do
      query =
        from f in Finding,
          join: p in Page,
          on: p.id == f.page_id and p.audit_id == f.audit_id,
          where: f.id == ^finding_uuid and f.audit_id == ^audit_uuid,
          select: {f, struct(p, ^@page_summary_fields)}

      case Repo.one(query) do
        {finding, page} -> {:ok, finding_detail(finding, page)}
        nil -> missing(audit_uuid, :finding_not_found)
      end
    end
  end

  defp finding_detail(%Finding{} = finding, %Page{} = page) do
    rows =
      Repo.all(
        from o in subquery(
               rule_occurrences(finding.audit_id,
                 rule_id: finding.rule_id,
                 needs_review: finding.needs_review
               )
             ),
             join: p in Page,
             on: p.id == o.page_id,
             order_by: [desc: o.occurrences, asc: p.url, asc: p.id],
             select: %{page_id: p.id, url: p.url, title: p.title, occurrences: o.occurrences}
      )

    {own, others} = Enum.split_with(rows, &(&1.page_id == page.id))

    %{
      finding: finding,
      page: page,
      occurrences: %{
        page: Enum.sum_by(own, & &1.occurrences),
        audit: Enum.sum_by(rows, & &1.occurrences)
      },
      other_pages: others
    }
  end

  ## Apoio

  # UUID inválido da auditoria: `audit_not_found`. UUID inválido do item, numa auditoria
  # válida: decide como o item inexistente (a auditoria pode não existir).
  defp cast_or(id, code) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, code}
    end
  end

  defp cast_or(id, code, audit_uuid) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> missing(audit_uuid, code)
    end
  end

  # O item não está na auditoria: se nem a auditoria existe, é ela que falta.
  defp missing(audit_uuid, code) do
    if Repo.exists?(from a in Audit, where: a.id == ^audit_uuid),
      do: {:error, code},
      else: {:error, :audit_not_found}
  end
end
