defmodule Rampa.Audits.Page do
  @moduledoc "Uma página de uma auditoria e o resultado da sua varredura (PRD §8)."

  use Ecto.Schema

  import Ecto.Changeset

  alias Rampa.Audits.{Audit, Finding}

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

    belongs_to :audit, Audit
    has_many :findings, Finding

    timestamps(type: :utc_datetime)
  end

  @doc "Status da página durante a varredura (`scanning`, `failed`...), com o código de erro."
  @spec status_changeset(t(), map()) :: Ecto.Changeset.t()
  def status_changeset(page, attrs) do
    page
    |> cast(attrs, [:status, :error])
    |> validate_required([:status])
  end

  @doc "Fatos devolvidos pelo scanner para a página."
  @spec scan_changeset(t(), map()) :: Ecto.Changeset.t()
  def scan_changeset(page, attrs) do
    page
    |> cast(attrs, [:status, :error, :final_url, :http_status, :title, :axe_version, :scanned_at])
    |> validate_required([:status, :final_url, :axe_version, :scanned_at])
    |> validate_number(:http_status, greater_than_or_equal_to: 100, less_than: 600)
  end
end
