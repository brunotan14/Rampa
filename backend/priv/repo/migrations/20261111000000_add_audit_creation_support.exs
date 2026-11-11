defmodule Rampa.Repo.Migrations.AddAuditCreationSupport do
  use Ecto.Migration

  # Criação de auditorias pelo `POST /api/audits` (RF-RA001, RF-RA002):
  #
  #   * `idempotency_key`: o cabeçalho `Idempotency-Key`, único por solicitante. Índice
  #     parcial: auditoria sem chave não entra nele;
  #   * índices das contagens do limite de taxa (por hash de IP na última hora e do dia todo);
  #   * índice da paginação dos achados por cursor, `(inserted_at, id)` dentro da auditoria.
  def change do
    alter table(:audits) do
      add :idempotency_key, :string
    end

    create constraint(:audits, :idempotency_key_length,
             check: "idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128"
           )

    create unique_index(:audits, [:requester_ip_hash, :idempotency_key],
             name: :audits_requester_idempotency_key_index,
             where: "idempotency_key IS NOT NULL"
           )

    create index(:audits, [:requester_ip_hash, :inserted_at])
    create index(:audits, [:inserted_at])

    create index(:findings, [:audit_id, :inserted_at, :id])
  end
end
