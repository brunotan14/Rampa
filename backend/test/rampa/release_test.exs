defmodule Rampa.ReleaseTest do
  @moduledoc """
  Migrations da release (`bin/migrate`, `infra/deploy.sh`): rodam com `lock_timeout`, para uma
  trava presa pelo app da versão anterior falhar o deploy em segundos em vez de parar o app.
  """

  use ExUnit.Case, async: true

  alias Rampa.Release

  test "a configuração das migrations põe o lock_timeout e mantém o resto" do
    config = Release.migration_config(url: "ecto://x", parameters: [application_name: "rampa"])

    assert config[:url] == "ecto://x"
    assert config[:parameters][:lock_timeout] == "5s"
    assert config[:parameters][:application_name] == "rampa"
    assert Release.migration_config([])[:parameters] == [lock_timeout: "5s"]
  end

  test "o PostgreSQL aplica o lock_timeout na sessão das migrations" do
    config =
      Rampa.Repo.config()
      |> Keyword.drop([:pool, :pool_size, :name])
      |> Release.migration_config()

    conn = start_supervised!({Postgrex, config})

    assert %Postgrex.Result{rows: [["5s"]]} = Postgrex.query!(conn, "SHOW lock_timeout", [])
  end
end
