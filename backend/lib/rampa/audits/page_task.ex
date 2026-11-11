defmodule Rampa.Audits.PageTask do
  @moduledoc """
  Uma tarefa de uma página: a varredura (`scan`) ou, a partir do M4, uma análise de IA.

  O estado da página e o fim da auditoria são decididos pelas tarefas, nunca pela fila do
  Oban (regras em `Rampa.Audits.Rules`). Uma tarefa de cada `kind` por página.

  Os cinco `kind` já existem para o ciclo inteiro ser testado contra o banco, mas no M1 só
  `scan` é criado pelo fluxo normal: `alt_text`, `links`, `focus` e `headings` ganham job no
  M4 (RF-RA008 a RF-RA011).

  `attempt` conta as vezes que a tarefa começou. Normalmente é o `attempt` do Oban; depois
  de um reenfileiramento pela reconciliação, continua contando a partir do anterior.
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias Rampa.Audits.{Audit, Page}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @kinds [:scan, :alt_text, :links, :focus, :headings]
  @statuses [:pending, :running, :done, :failed]

  @type kind :: :scan | :alt_text | :links | :focus | :headings
  @type status :: :pending | :running | :done | :failed
  @type t :: %__MODULE__{}

  schema "page_tasks" do
    field :kind, Ecto.Enum, values: @kinds
    field :status, Ecto.Enum, values: @statuses, default: :pending
    field :attempt, :integer, default: 0
    field :error, :string
    field :started_at, :utc_datetime
    field :finished_at, :utc_datetime

    belongs_to :page, Page
    belongs_to :audit, Audit

    timestamps(type: :utc_datetime)
  end

  @spec kinds() :: [kind()]
  def kinds, do: @kinds

  @doc "Tarefa nova, sempre `pending`, de uma página já gravada."
  @spec create_changeset(Page.t(), map()) :: Ecto.Changeset.t()
  def create_changeset(%Page{} = page, attrs) do
    %__MODULE__{page_id: page.id, audit_id: page.audit_id, status: :pending, attempt: 0}
    |> cast(attrs, [:kind])
    |> validate_required([:kind, :page_id, :audit_id])
    |> unique_constraint([:page_id, :kind])
    |> db_constraints()
  end

  @doc "Mudança de estado feita pelas transições de `Rampa.Audits`."
  @spec transition_changeset(t(), map()) :: Ecto.Changeset.t()
  def transition_changeset(task, attrs) do
    task
    |> cast(attrs, [:status, :attempt, :error, :started_at, :finished_at])
    |> validate_required([:status, :attempt])
    |> validate_number(:attempt, greater_than_or_equal_to: 0)
    |> db_constraints()
  end

  defp db_constraints(changeset) do
    changeset
    |> check_constraint(:kind, name: :kind_valid)
    |> check_constraint(:status, name: :status_valid)
    |> check_constraint(:attempt, name: :attempt_non_negative)
    |> check_constraint(:started_at, name: :running_requires_started_at)
    |> check_constraint(:finished_at, name: :finished_requires_finished_at)
    |> check_constraint(:error, name: :failed_requires_error)
    |> foreign_key_constraint(:page_id, name: :page_tasks_page_id_fkey)
  end
end
