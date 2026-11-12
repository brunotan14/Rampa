defmodule Rampa.Audits.FindingCounts do
  @moduledoc """
  A única contagem de achados do Rampa: o snapshot e os eventos do canal `audit:<id>`
  (RF-RA004), o resumo (`GET /api/audits/:id`, RF-RA005) e as páginas (`GET .../pages`,
  RF-RA006) saem daqui, para nunca divergirem.

  Cada linha traz os confirmados (`needs_review = false`) por severidade, os que pedem
  revisão por severidade (`review_*`) e o total dos que pedem revisão (`needs_review`).
  `split/1` separa os três.
  """

  import Ecto.Query

  alias Rampa.Audits.Finding

  @severities Finding.severities()

  @type severity_totals :: %{Finding.severity() => non_neg_integer()}

  @doc """
  Contagens de uma auditoria (`:audit_id`) ou de uma página (`:page_id`). Agregado sem
  `GROUP BY`: sempre uma linha, zerada sem achados. Para usar como subconsulta.
  """
  @spec query(:audit_id | :page_id, Ecto.UUID.t()) :: Ecto.Query.t()
  def query(scope, id) when scope in [:audit_id, :page_id] do
    from f in Finding, where: field(f, ^scope) == ^id, select: ^select()
  end

  @doc """
  Contagens de cada página da auditoria (`page_id` em cada linha); página sem achado não
  aparece. Para usar como subconsulta.
  """
  @spec by_page(Ecto.UUID.t()) :: Ecto.Query.t()
  def by_page(audit_id) do
    from f in Finding,
      where: f.audit_id == ^audit_id,
      group_by: f.page_id,
      select: ^Map.put(select(), :page_id, dynamic([f], f.page_id))
  end

  @doc """
  `{confirmados por severidade, a revisar por severidade, total a revisar}`. `nil` (página
  sem achado num `LEFT JOIN`) vale zero.
  """
  @spec split(map() | nil) :: {severity_totals(), severity_totals(), non_neg_integer()}
  def split(nil), do: split(%{})

  def split(counts) do
    confirmed = Map.new(@severities, &{&1, Map.get(counts, &1) || 0})
    review = Map.new(@severities, &{&1, Map.get(counts, :"review_#{&1}") || 0})
    {confirmed, review, Map.get(counts, :needs_review) || 0}
  end

  defp select do
    confirmed =
      for severity <- @severities,
          into: %{},
          do:
            {severity,
             dynamic([f], filter(count(f.id), f.severity == ^severity and not f.needs_review))}

    review =
      for severity <- @severities,
          into: %{},
          do:
            {:"review_#{severity}",
             dynamic([f], filter(count(f.id), f.severity == ^severity and f.needs_review))}

    confirmed
    |> Map.merge(review)
    |> Map.put(:needs_review, dynamic([f], filter(count(f.id), f.needs_review)))
  end
end
