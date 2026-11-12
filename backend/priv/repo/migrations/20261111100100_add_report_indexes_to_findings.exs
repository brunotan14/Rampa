defmodule Rampa.Repo.Migrations.AddReportIndexesToFindings do
  use Ecto.Migration

  # Consultas do relatório (RF-RA005 a RF-RA007):
  #
  #   * `severity_rank`: posição da severidade (0 = critical ... 3 = minor), coluna gerada
  #     para a ordem `sort=severity` da lista de achados e para o "mais grave" do top 5. O
  #     app nunca escreve nela;
  #   * índice da ordem `sort=severity` com a paginação por âncora:
  #     `(audit_id, severity_rank, rule_id, inserted_at, id)`;
  #   * índice das ocorrências por regra (`Rampa.Audits.rule_occurrences/2`: top 5, detalhe e
  #     "onde mais aparece"): `(audit_id, rule_id, needs_review, page_id)`.
  def up do
    execute """
    ALTER TABLE findings ADD COLUMN severity_rank smallint GENERATED ALWAYS AS (
      CASE severity
        WHEN 'critical' THEN 0
        WHEN 'serious' THEN 1
        WHEN 'moderate' THEN 2
        WHEN 'minor' THEN 3
      END
    ) STORED
    """

    create index(:findings, [:audit_id, :severity_rank, :rule_id, :inserted_at, :id],
             name: :findings_audit_severity_order_index
           )

    create index(:findings, [:audit_id, :rule_id, :needs_review, :page_id],
             name: :findings_audit_rule_occurrences_index
           )
  end

  def down do
    drop index(:findings, [:audit_id, :rule_id, :needs_review, :page_id],
           name: :findings_audit_rule_occurrences_index
         )

    drop index(:findings, [:audit_id, :severity_rank, :rule_id, :inserted_at, :id],
           name: :findings_audit_severity_order_index
         )

    execute "ALTER TABLE findings DROP COLUMN severity_rank"
  end
end
