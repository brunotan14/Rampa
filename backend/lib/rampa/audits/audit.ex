defmodule Rampa.Audits.Audit do
  @moduledoc """
  Uma auditoria: a URL inicial e o andamento da varredura (PRD §8).

  Não há changeset de criação neste marco: a auditoria só pode nascer depois da validação de
  URL e da proteção contra SSRF (RF-RA001, RF-RA002), que entram em `POST /api/audits`.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias Rampa.Audits.{Finding, Page}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @statuses [:queued, :running, :completed, :failed, :cancelled]

  @type status :: :queued | :running | :completed | :failed | :cancelled
  @type t :: %__MODULE__{}

  schema "audits" do
    field :start_url, :string
    field :page_limit, :integer, default: 1
    field :status, Ecto.Enum, values: @statuses, default: :queued
    field :score, :integer
    field :pages_found, :integer, default: 0
    field :pages_scanned, :integer, default: 0
    field :pages_failed, :integer, default: 0
    field :requester_ip_hash, :string
    field :error, :string
    field :started_at, :utc_datetime
    field :finished_at, :utc_datetime
    field :expires_at, :utc_datetime

    has_many :pages, Page
    has_many :findings, Finding

    timestamps(type: :utc_datetime)
  end

  @doc "Mudança de andamento feita pelos jobs: status, contadores, erro e horários."
  @spec progress_changeset(t(), map()) :: Ecto.Changeset.t()
  def progress_changeset(audit, attrs) do
    audit
    |> cast(attrs, [
      :status,
      :pages_found,
      :pages_scanned,
      :pages_failed,
      :error,
      :started_at,
      :finished_at
    ])
    |> validate_required([:status])
    |> validate_number(:pages_found, greater_than_or_equal_to: 0)
    |> validate_number(:pages_scanned, greater_than_or_equal_to: 0)
    |> validate_number(:pages_failed, greater_than_or_equal_to: 0)
    |> validate_finished_at()
    |> check_constraint(:status, name: :status_valid)
    |> check_constraint(:pages_found, name: :counters_non_negative)
    |> check_constraint(:finished_at, name: :finished_requires_finished_at)
  end

  @doc "Estados em que a auditoria não aceita mais mudança."
  @spec final_statuses() :: [status()]
  def final_statuses, do: [:completed, :failed, :cancelled]

  # `completed` e `failed` exigem `finished_at` (o banco também confere).
  defp validate_finished_at(changeset) do
    if get_field(changeset, :status) in [:completed, :failed] do
      validate_required(changeset, [:finished_at])
    else
      changeset
    end
  end
end
