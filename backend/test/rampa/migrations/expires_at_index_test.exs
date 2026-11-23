defmodule Rampa.Migrations.ExpiresAtIndexTest do
  @moduledoc """
  RF-RA014: o índice da limpeza da retenção (`audits_expires_at_index`), criado
  `CONCURRENTLY` pela migration `AddExpiresAtIndexToAudits`.

  O segundo teste reproduz uma tentativa anterior que falhou no meio (índice `INVALID`) e roda
  a migration de novo, de verdade: conexão **fora do sandbox** e `async: false`. Ao final, a
  migration fica aplicada como antes, mesmo se o teste falhar no meio.
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias Rampa.Repo

  @index "audits_expires_at_index"
  @version 20_261_123_100_000
  @path Path.expand(
          "../../../priv/repo/migrations/20261123100000_add_expires_at_index_to_audits.exs",
          __DIR__
        )

  setup_all do
    [{migration, _bytecode}] = Code.compile_file(@path)
    %{migration: migration}
  end

  setup do
    :ok = Sandbox.checkout(Repo, sandbox: false)
    on_exit(fn -> Sandbox.checkin(Repo) end)
  end

  # `[{indisvalid, definição}]` do índice, ou `[]` se não existe.
  defp index_state do
    Repo.query!(
      """
      SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = $1
      """,
      [@index]
    ).rows
  end

  defp migrated?,
    do: Repo.query!("SELECT 1 FROM schema_migrations WHERE version = $1", [@version]).rows != []

  test "CA2.2 o índice de expires_at existe e é válido" do
    assert [[true, definition]] = index_state()
    assert definition =~ "ON public.audits USING btree (expires_at)"
  end

  test "CA2.2 índice INVALID de uma tentativa anterior é removido e recriado válido",
       %{migration: migration} do
    on_exit(fn ->
      :ok = Sandbox.checkout(Repo, sandbox: false)

      # Volta ao estado migrado com o índice válido, falhe o teste onde falhar.
      unless migrated?() and match?([[true, _definition]], index_state()) do
        if migrated?(), do: Ecto.Migrator.down(Repo, @version, migration, log: false)
        Repo.query!("DROP INDEX IF EXISTS #{@index}")
        Ecto.Migrator.up(Repo, @version, migration, log: false)
      end

      Sandbox.checkin(Repo)
    end)

    :ok = Ecto.Migrator.down(Repo, @version, migration, log: false)
    assert index_state() == []
    refute migrated?()

    # O que sobra de um `CREATE INDEX CONCURRENTLY` interrompido: o índice marcado INVALID.
    Repo.query!("CREATE INDEX #{@index} ON audits (expires_at)")

    Repo.query!("UPDATE pg_index SET indisvalid = false WHERE indexrelid = '#{@index}'::regclass")

    assert [[false, _definition]] = index_state()

    assert :ok = Ecto.Migrator.up(Repo, @version, migration, log: false)

    assert [[true, _definition]] = index_state()
    assert migrated?()
  end
end
