defmodule Rampa.Release do
  @moduledoc """
  Tarefas da release, sem o Mix (PRD §7, Hospedagem e deploy). As migrations rodam com
  `bin/migrate` antes de trocar os containers; no Compose de teste
  (`infra/docker-compose.test.yml`), antes de subir o servidor.
  """

  @app :rampa

  @doc "Roda todas as migrations pendentes de todos os repositórios."
  @spec migrate() :: :ok
  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _migrated, _apps} =
        Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end

    :ok
  end

  @doc "Desfaz as migrations do repositório até a versão informada (inclusive)."
  @spec rollback(module(), integer()) :: :ok
  def rollback(repo, version) do
    load_app()

    {:ok, _migrated, _apps} =
      Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))

    :ok
  end

  defp repos, do: Application.fetch_env!(@app, :ecto_repos)

  defp load_app do
    # Muitos provedores exigem SSL na conexão com o banco.
    Application.ensure_all_started(:ssl)
    Application.ensure_loaded(@app)
  end
end
