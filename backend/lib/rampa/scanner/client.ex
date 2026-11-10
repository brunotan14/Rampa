defmodule Rampa.Scanner.Client do
  @moduledoc """
  Contrato com o serviço scanner (PRD §7). A implementação é escolhida por
  configuração (`:scanner_client`), para os testes usarem Mox.

  `scan/1` devolve o corpo da resposta de `POST /scan` (mapa com chaves em texto, como veio
  do JSON) ou um erro com um dos códigos do contrato. `:unavailable` indica que o scanner
  não respondeu ou respondeu algo fora do contrato.
  """

  @type error_code ::
          :blocked_address | :timeout | :http_error | :navigation_failed | :unavailable
  @type scan_error :: %{code: error_code(), detail: String.t()}

  @callback health() :: :ok | {:error, term()}

  @callback scan(url :: String.t()) :: {:ok, map()} | {:error, scan_error()}

  @spec impl() :: module()
  def impl, do: Application.fetch_env!(:rampa, :scanner_client)
end
