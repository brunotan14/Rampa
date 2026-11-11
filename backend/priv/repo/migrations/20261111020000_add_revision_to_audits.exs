defmodule Rampa.Repo.Migrations.AddRevisionToAudits do
  use Ecto.Migration

  # Versão do andamento da auditoria (RF-RA004, PRD §9). Sobe a cada escrita que passa por
  # `Rampa.Audits` com a auditoria travada, então é estritamente crescente na ordem de commit:
  # o cliente aplica o estado de maior `revision` que recebeu (canal ou `GET /api/audits/:id`),
  # em qualquer ordem de chegada. Padrão 0: o PostgreSQL acrescenta a coluna sem reescrever a
  # tabela, e o código anterior continua funcionando.
  def change do
    alter table(:audits) do
      add :revision, :bigint, null: false, default: 0
    end

    create constraint(:audits, :revision_non_negative, check: "revision >= 0")
  end
end
