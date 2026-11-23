defmodule Rampa.Repo.Migrations.AddExpiresAtIndexToAudits do
  use Ecto.Migration

  # Retenção (RF-RA014): índice em `audits(expires_at)` para a limpeza diária
  # (`Rampa.Audits.purge_expired/1`). Linhas antigas, com `expires_at` nulo, vencem pelo
  # `inserted_at` (índice que já existe), sem backfill aqui: o `UPDATE` disputaria trava com as
  # transições sob o `lock_timeout` de 5 s da release. Backfill e `NOT NULL` vêm num deploy
  # seguinte (contração). Compatível com a versão anterior do app: só acrescenta um índice.
  #
  # `CONCURRENTLY`, sem transação nem trava de migrations, para não bloquear escritas em
  # `audits`. Se uma tentativa anterior falhou no meio, o índice fica `INVALID`: ele é
  # removido antes de recriar. A checagem é feita aqui, no Elixir, porque o PostgreSQL recusa
  # `DROP INDEX CONCURRENTLY` dentro de um bloco `DO` ("cannot be executed from a function").
  @disable_ddl_transaction true
  @disable_migration_lock true

  @index "audits_expires_at_index"

  def up do
    if invalid_index?() do
      execute "DROP INDEX CONCURRENTLY IF EXISTS #{@index}"
    end

    create_if_not_exists index(:audits, [:expires_at], concurrently: true)
  end

  def down do
    drop_if_exists index(:audits, [:expires_at], concurrently: true)
  end

  # Roda na hora (antes dos comandos enfileirados por `execute` e `create`).
  defp invalid_index? do
    %{rows: rows} =
      repo().query!(
        """
        SELECT 1
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = $1 AND n.nspname = current_schema() AND NOT i.indisvalid
        """,
        [@index],
        log: false
      )

    rows != []
  end
end
