defmodule Rampa.Scanner.Client do
  @moduledoc """
  Contrato com o serviço scanner (PRD §7). A implementação é escolhida por
  configuração (`:scanner_client`), para os testes usarem Mox.
  """

  @callback health() :: :ok | {:error, term()}

  @spec impl() :: module()
  def impl, do: Application.fetch_env!(:rampa, :scanner_client)
end
