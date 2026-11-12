defmodule Rampa.Audits.JSONList do
  @moduledoc """
  Tipo Ecto de uma coluna `jsonb` que guarda uma **lista** (o tipo `:map` do Ecto só aceita
  mapa). Usado em `pages.passed_rules` (RF-RA017). `nil` continua `nil`: na coluna, `NULL`
  quer dizer "não coletado", diferente de `[]`.
  """

  use Ecto.Type

  @impl true
  def type, do: :map

  @impl true
  def cast(nil), do: {:ok, nil}
  def cast(list) when is_list(list), do: {:ok, list}
  def cast(_other), do: :error

  @impl true
  def load(list) when is_list(list), do: {:ok, list}
  def load(_other), do: :error

  @impl true
  def dump(nil), do: {:ok, nil}
  def dump(list) when is_list(list), do: {:ok, list}
  def dump(_other), do: :error
end
