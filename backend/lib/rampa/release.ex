defmodule Rampa.Release do
  @moduledoc """
  Tarefas da release, sem o Mix (PRD §7, Hospedagem e deploy). As migrations rodam com
  `bin/migrate` antes de trocar os containers; no Compose de teste
  (`infra/docker-compose.test.yml`), antes de subir o servidor.
  """

  @app :rampa

  # Espera máxima por uma trava nas migrations da release (`lock_timeout` do PostgreSQL). O
  # app da versão anterior continua de pé durante o `bin/migrate` (`infra/deploy.sh`): uma
  # migration que precisa de trava exclusiva numa tabela em uso falha em 5 s, e o deploy para
  # antes de trocar os containers, em vez de enfileirar todas as consultas do app atrás dela.
  @migration_lock_timeout "5s"

  @doc "Roda todas as migrations pendentes de todos os repositórios."
  @spec migrate() :: :ok
  def migrate do
    load_app()

    for repo <- repos() do
      put_migration_config(repo)

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

  @doc """
  Configuração do repositório para as migrations: a de `runtime.exs` com o `lock_timeout`
  nos parâmetros da sessão (Postgrex `:parameters`), sem perder os que já existirem.
  """
  @spec migration_config(keyword()) :: keyword()
  def migration_config(config) do
    parameters = Keyword.put(config[:parameters] || [], :lock_timeout, @migration_lock_timeout)
    Keyword.put(config, :parameters, parameters)
  end

  # A release roda `bin/migrate` num nó próprio (`rampa eval`), com o repositório parado: a
  # configuração alterada aqui só vale para as migrations.
  defp put_migration_config(repo) do
    Application.put_env(@app, repo, migration_config(Application.get_env(@app, repo, [])))
  end

  defp repos, do: Application.fetch_env!(@app, :ecto_repos)

  defp load_app do
    # Muitos provedores exigem SSL na conexão com o banco.
    Application.ensure_all_started(:ssl)
    Application.ensure_loaded(@app)
  end
end
