defmodule Rampa.Repo.Migrations.AddRequeuesToPageTasks do
  use Ecto.Migration

  # Quantas vezes a reconciliação reenfileirou a tarefa. Limita o reenfileiramento de uma
  # tarefa cujo job morre sempre antes de começar (`Rampa.Audits.reconcile_stale_tasks/1`).
  def change do
    alter table(:page_tasks) do
      add :requeues, :integer, null: false, default: 0
    end

    create constraint(:page_tasks, :requeues_non_negative, check: "requeues >= 0")
  end
end
