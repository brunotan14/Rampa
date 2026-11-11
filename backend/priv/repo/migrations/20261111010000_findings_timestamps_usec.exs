defmodule Rampa.Repo.Migrations.FindingsTimestampsUsec do
  use Ecto.Migration

  # Paginação dos achados por cursor em `(inserted_at, id)` (`GET /api/audits/:id/findings`):
  # com segundos, um achado gravado depois de a lista começar, no mesmo segundo e com id
  # menor, ficava antes do cursor e nunca aparecia. `updated_at` acompanha, para os dois
  # carimbos de `findings` terem a mesma precisão. As outras tabelas não paginam por data.
  def change do
    alter table(:findings) do
      modify :inserted_at, :utc_datetime_usec, from: :utc_datetime
      modify :updated_at, :utc_datetime_usec, from: :utc_datetime
    end
  end
end
