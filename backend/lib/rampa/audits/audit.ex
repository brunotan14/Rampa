defmodule Rampa.Audits.Audit do
  @moduledoc """
  Uma auditoria: a URL inicial e o andamento da varredura (PRD §8).

  A auditoria só nasce por `Rampa.Audits.create_audit/3`, que passa a URL pelo
  `Rampa.Security.URLGuard` (RF-RA001, RF-RA002) antes de usar `create_changeset/1`.

  `requester_ip_hash` (HMAC do IP, `Rampa.Security.IPHash`) e `idempotency_key` (cabeçalho
  `Idempotency-Key`) servem ao limite de taxa e à idempotência do `POST /api/audits`; nunca
  saem pela API.

  `revision` é a versão do andamento (RF-RA004): sobe a cada escrita de `Rampa.Audits` com a
  auditoria travada, nunca por changeset de fora. O cliente aplica o estado de maior
  `revision`, venha do canal `audit:<id>` ou da API.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias Rampa.Audits.{Finding, Page}
  alias Rampa.Scanner.Contract

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
    field :idempotency_key, :string
    field :error, :string
    # Status HTTP da página cuja falha encerrou a auditoria (RF-RA029), junto com `error`.
    field :error_http_status, :integer
    field :started_at, :utc_datetime
    field :finished_at, :utc_datetime
    field :expires_at, :utc_datetime
    field :revision, :integer, default: 0

    has_many :pages, Page
    has_many :findings, Finding

    timestamps(type: :utc_datetime)
  end

  @doc """
  Auditoria nova, sempre `queued`. A URL já passou pelo `URLGuard` e o `page_limit` já foi
  conferido por `Rampa.Audits.create_audit/3`.
  """
  @spec create_changeset(map()) :: Ecto.Changeset.t()
  def create_changeset(attrs) do
    %__MODULE__{status: :queued}
    |> cast(attrs, [:start_url, :page_limit, :requester_ip_hash, :idempotency_key])
    |> validate_required([:start_url, :page_limit, :requester_ip_hash])
    |> validate_number(:page_limit, greater_than_or_equal_to: 1, less_than_or_equal_to: 25)
    |> validate_length(:idempotency_key, min: 1, max: 128)
    |> check_constraint(:page_limit, name: :page_limit_range)
    |> check_constraint(:idempotency_key, name: :idempotency_key_length)
    |> unique_constraint(:idempotency_key, name: :audits_requester_idempotency_key_index)
  end

  @doc """
  Mudança de andamento feita pelos jobs: status, contadores, erro (com o status HTTP da página
  que falhou) e horários.
  """
  @spec progress_changeset(t(), map()) :: Ecto.Changeset.t()
  def progress_changeset(audit, attrs) do
    audit
    |> cast(attrs, [
      :status,
      :pages_found,
      :pages_scanned,
      :pages_failed,
      :error,
      :error_http_status,
      :started_at,
      :finished_at
    ])
    |> validate_required([:status])
    |> validate_inclusion(:error_http_status, Contract.error_http_status_range())
    |> validate_number(:pages_found, greater_than_or_equal_to: 0)
    |> validate_number(:pages_scanned, greater_than_or_equal_to: 0)
    |> validate_number(:pages_failed, greater_than_or_equal_to: 0)
    |> validate_finished_at()
    |> check_constraint(:status, name: :status_valid)
    |> check_constraint(:pages_found, name: :counters_non_negative)
    |> check_constraint(:finished_at, name: :finished_requires_finished_at)
    |> check_constraint(:error_http_status, name: :error_http_status_range)
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
