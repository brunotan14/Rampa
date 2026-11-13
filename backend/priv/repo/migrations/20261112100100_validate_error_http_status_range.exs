defmodule Rampa.Repo.Migrations.ValidateErrorHttpStatusRange do
  use Ecto.Migration

  # Valida o CHECK criado sem validação em `AddLoginWallAndHttpStatus`, numa transação própria:
  # `VALIDATE CONSTRAINT` pega só `SHARE UPDATE EXCLUSIVE` em `audits`, que não bloqueia o app.
  def up do
    execute "ALTER TABLE audits VALIDATE CONSTRAINT error_http_status_range"
  end

  # Desfazer a validação não tem efeito no PostgreSQL; o CHECK some com a migration anterior.
  def down, do: :ok
end
