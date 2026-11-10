defmodule Rampa.Health do
  @moduledoc "Verifica se o app, o banco e o scanner estão respondendo (`GET /api/health`)."

  require Logger

  alias Ecto.Adapters.SQL
  alias Rampa.Scanner.Client

  @type status :: :ok | :error

  @spec check() :: %{app: status(), database: status(), scanner: status()}
  def check do
    %{app: :ok, database: database(), scanner: scanner()}
  end

  @spec healthy?(map()) :: boolean()
  def healthy?(checks), do: Enum.all?(checks, fn {_name, status} -> status == :ok end)

  defp database do
    case SQL.query(Rampa.Repo, "SELECT 1", []) do
      {:ok, _result} ->
        :ok

      {:error, reason} ->
        Logger.warning("health: banco indisponível: #{inspect(reason)}")
        :error
    end
  end

  defp scanner do
    case Client.impl().health() do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.warning("health: scanner indisponível: #{inspect(reason)}")
        :error
    end
  end
end
