defmodule Rampa.Audits.Finding do
  @moduledoc """
  Um problema encontrado numa página (PRD §8).

  `source` diz quem o apontou: o axe, a IA ou uma heurística própria. Achado de IA ou de
  heurística, e o `incomplete` do axe, têm `needs_review = true`: são sugestões a confirmar.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias Rampa.Audits.{Audit, Page}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @html_snippet_max_bytes 2048

  @sources [:axe, :ai, :heuristic]
  @severities [:critical, :serious, :moderate, :minor]

  @type source :: :axe | :ai | :heuristic
  @type severity :: :critical | :serious | :moderate | :minor
  @type t :: %__MODULE__{}

  schema "findings" do
    field :source, Ecto.Enum, values: @sources
    field :rule_id, :string
    field :wcag_criteria, {:array, :string}, default: []
    field :severity, Ecto.Enum, values: @severities
    field :needs_review, :boolean, default: false
    field :confidence, :float
    field :selector, :string
    field :html_snippet, :string
    field :message, :string
    field :who_is_affected, :string
    field :how_to_fix, :string
    field :ai_reason, :string
    field :ai_suggestion, :string
    field :ai_model, :string
    field :prompt_version, :string
    field :crop_path, :string
    field :raw, :map

    belongs_to :page, Page
    belongs_to :audit, Audit

    timestamps(type: :utc_datetime)
  end

  @doc "Tamanho máximo do trecho de HTML guardado, em bytes (RNF-RA005)."
  @spec html_snippet_max_bytes() :: pos_integer()
  def html_snippet_max_bytes, do: @html_snippet_max_bytes

  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(finding, attrs) do
    finding
    |> cast(attrs, [
      :page_id,
      :audit_id,
      :source,
      :rule_id,
      :wcag_criteria,
      :severity,
      :needs_review,
      :confidence,
      :selector,
      :html_snippet,
      :message,
      :who_is_affected,
      :how_to_fix,
      :ai_reason,
      :ai_suggestion,
      :ai_model,
      :prompt_version,
      :crop_path,
      :raw
    ])
    |> validate_required([:page_id, :audit_id, :source, :rule_id, :severity, :needs_review])
    |> validate_length(:html_snippet, max: @html_snippet_max_bytes, count: :bytes)
    |> validate_number(:confidence, greater_than_or_equal_to: 0, less_than_or_equal_to: 1)
    |> check_constraint(:html_snippet, name: :html_snippet_max_2kb)
    |> check_constraint(:confidence, name: :confidence_range)
    |> foreign_key_constraint(:page_id)
    |> foreign_key_constraint(:audit_id)
  end
end
