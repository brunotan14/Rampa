defmodule Rampa.Audits.Page do
  @moduledoc "Uma página de uma auditoria e o resultado da sua varredura (PRD §8)."

  use Ecto.Schema

  import Ecto.Changeset

  alias Rampa.Audits.{Audit, Finding, JSONList, PageTask}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @statuses [:queued, :scanning, :analyzing, :done, :failed]

  @type status :: :queued | :scanning | :analyzing | :done | :failed
  @type t :: %__MODULE__{}

  schema "pages" do
    field :url, :string
    field :final_url, :string
    field :http_status, :integer
    field :title, :string
    field :status, Ecto.Enum, values: @statuses, default: :queued
    field :error, :string
    field :axe_version, :string
    field :scanned_at, :utc_datetime
    # Regras do axe aprovadas (RF-RA017): `%{"rule_id", "wcag_criteria", "help",
    # "nodes_total"}`, sem as que também falharam na página
    # (`Rampa.Audits.AxeMapper.passed_rules/1`). `nil` = não coletado.
    field :passed_rules, JSONList
    # A página pede login (RF-RA028), segundo `Rampa.Audits.LoginWall`. `nil` = não sabido.
    field :login_wall, :boolean

    belongs_to :audit, Audit
    has_many :findings, Finding
    has_many :tasks, PageTask

    timestamps(type: :utc_datetime)
  end

  @doc "Página nova de uma auditoria, sempre `queued`. A URL já passou pelo `URLGuard`."
  @spec create_changeset(Audit.t(), String.t()) :: Ecto.Changeset.t()
  def create_changeset(%Audit{} = audit, url) do
    %__MODULE__{audit_id: audit.id, status: :queued}
    |> change(url: url)
    |> validate_required([:url, :audit_id])
    |> unique_constraint([:audit_id, :url])
    |> db_constraints()
  end

  @doc """
  Estado derivado das tarefas (`Rampa.Audits.Rules.page_status/1`) e, ao fim do scan, os
  fatos devolvidos pelo scanner. `analyzing` e `done` exigem `scanned_at` e `axe_version`;
  `failed` exige `error`.
  """
  @spec progress_changeset(t(), map()) :: Ecto.Changeset.t()
  def progress_changeset(page, attrs) do
    page
    |> cast(attrs, [
      :status,
      :error,
      :final_url,
      :http_status,
      :title,
      :axe_version,
      :scanned_at,
      :passed_rules,
      :login_wall
    ])
    |> validate_required([:status])
    |> validate_number(:http_status, greater_than_or_equal_to: 100, less_than: 600)
    |> validate_by_status()
    |> db_constraints()
  end

  defp validate_by_status(changeset) do
    case get_field(changeset, :status) do
      status when status in [:analyzing, :done] ->
        validate_required(changeset, [:final_url, :axe_version, :scanned_at])

      :failed ->
        validate_required(changeset, [:error])

      _open ->
        changeset
    end
  end

  defp db_constraints(changeset) do
    changeset
    |> check_constraint(:status, name: :status_valid)
    |> check_constraint(:http_status, name: :http_status_range)
    |> check_constraint(:scanned_at, name: :scanned_requires_scan_data)
    |> check_constraint(:error, name: :failed_requires_error)
    |> check_constraint(:passed_rules, name: :passed_rules_shape)
  end
end
