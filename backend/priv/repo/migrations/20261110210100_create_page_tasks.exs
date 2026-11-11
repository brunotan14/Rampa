defmodule Rampa.Repo.Migrations.CreatePageTasks do
  use Ecto.Migration

  # Tarefas persistidas por página (docs/adr/0001-ciclo-de-vida-da-auditoria.md). O fim da
  # página e o da auditoria são decididos por elas, nunca pela fila do Oban.
  def change do
    create table(:page_tasks, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :audit_id, references(:audits, type: :binary_id, on_delete: :delete_all), null: false

      # Chave composta: o `audit_id` da tarefa é obrigatoriamente o da página.
      add :page_id,
          references(:pages,
            type: :binary_id,
            with: [audit_id: :audit_id],
            on_delete: :delete_all
          ),
          null: false

      add :kind, :string, null: false
      add :status, :string, null: false, default: "pending"
      add :attempt, :integer, null: false, default: 0
      add :error, :string
      add :started_at, :utc_datetime
      add :finished_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:page_tasks, [:page_id, :kind])
    # Regra de conclusão: tarefas abertas da auditoria.
    create index(:page_tasks, [:audit_id, :status])
    # Reconciliação: só as tarefas abertas interessam.
    create index(:page_tasks, [:status, :updated_at],
             where: "status IN ('pending', 'running')",
             name: :page_tasks_open_index
           )

    create constraint(:page_tasks, :kind_valid,
             check: "kind IN ('scan', 'alt_text', 'links', 'focus', 'headings')"
           )

    create constraint(:page_tasks, :status_valid,
             check: "status IN ('pending', 'running', 'done', 'failed')"
           )

    create constraint(:page_tasks, :attempt_non_negative, check: "attempt >= 0")

    create constraint(:page_tasks, :running_requires_started_at,
             check: "status <> 'running' OR started_at IS NOT NULL"
           )

    create constraint(:page_tasks, :finished_requires_finished_at,
             check: "status NOT IN ('done', 'failed') OR finished_at IS NOT NULL"
           )

    create constraint(:page_tasks, :failed_requires_error,
             check: "status <> 'failed' OR error IS NOT NULL"
           )

    # Páginas que já existiam ganham a tarefa `scan` no estado equivalente.
    execute(
      """
      INSERT INTO page_tasks
        (id, audit_id, page_id, kind, status, attempt, error, started_at, finished_at,
         inserted_at, updated_at)
      SELECT
        gen_random_uuid(), p.audit_id, p.id, 'scan',
        CASE p.status
          WHEN 'queued' THEN 'pending'
          WHEN 'scanning' THEN 'running'
          WHEN 'failed' THEN 'failed'
          ELSE 'done'
        END,
        CASE WHEN p.status = 'queued' THEN 0 ELSE 1 END,
        CASE WHEN p.status = 'failed' THEN p.error END,
        CASE WHEN p.status <> 'queued' THEN COALESCE(p.scanned_at, p.updated_at) END,
        CASE WHEN p.status IN ('analyzing', 'done', 'failed')
          THEN COALESCE(p.scanned_at, p.updated_at) END,
        p.inserted_at, p.updated_at
      FROM pages p
      """,
      # Na volta, a tabela inteira é apagada logo depois.
      fn -> :ok end
    )
  end
end
