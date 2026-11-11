defmodule Rampa.Repo.Migrations.AddAuditInvariants do
  use Ecto.Migration

  # Invariantes do modelo de dados (PRD §8; ciclo de vida em `Rampa.Audits.Rules`).
  # Os valores repetem os `Ecto.Enum` dos schemas de propósito: a migration não depende do
  # código da aplicação, que muda depois dela.
  def change do
    create constraint(:audits, :status_valid,
             check: "status IN ('queued', 'running', 'completed', 'failed', 'cancelled')"
           )

    create constraint(:audits, :counters_non_negative,
             check: "pages_found >= 0 AND pages_scanned >= 0 AND pages_failed >= 0"
           )

    create constraint(:audits, :finished_requires_finished_at,
             check: "status NOT IN ('completed', 'failed') OR finished_at IS NOT NULL"
           )

    create constraint(:pages, :status_valid,
             check: "status IN ('queued', 'scanning', 'analyzing', 'done', 'failed')"
           )

    create constraint(:pages, :http_status_range,
             check: "http_status IS NULL OR http_status BETWEEN 100 AND 599"
           )

    # `analyzing` também: o scan já deu certo e os dados dele estão gravados.
    create constraint(:pages, :scanned_requires_scan_data,
             check:
               "status NOT IN ('analyzing', 'done') OR " <>
                 "(scanned_at IS NOT NULL AND axe_version IS NOT NULL)"
           )

    create constraint(:pages, :failed_requires_error,
             check: "status <> 'failed' OR error IS NOT NULL"
           )

    create constraint(:findings, :source_valid, check: "source IN ('axe', 'ai', 'heuristic')")

    create constraint(:findings, :severity_valid,
             check: "severity IN ('critical', 'serious', 'moderate', 'minor')"
           )

    # Alvo das chaves estrangeiras compostas: o `audit_id` repetido em achados e tarefas tem
    # de ser o da página.
    create unique_index(:pages, [:id, :audit_id])

    execute(
      """
      ALTER TABLE findings
        DROP CONSTRAINT findings_page_id_fkey,
        ADD CONSTRAINT findings_page_id_fkey FOREIGN KEY (page_id, audit_id)
          REFERENCES pages (id, audit_id) ON DELETE CASCADE
      """,
      """
      ALTER TABLE findings
        DROP CONSTRAINT findings_page_id_fkey,
        ADD CONSTRAINT findings_page_id_fkey FOREIGN KEY (page_id)
          REFERENCES pages (id) ON DELETE CASCADE
      """
    )
  end
end
