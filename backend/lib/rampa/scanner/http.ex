defmodule Rampa.Scanner.HTTP do
  @moduledoc """
  Implementação do `Rampa.Scanner.Client` que fala HTTP com o serviço scanner.

  Toda resposta passa por `Rampa.Scanner.Contract` antes de sair daqui, e portanto antes de
  qualquer gravação: o resultado `{:ok, body}` sempre cumpre o schema
  `shared/scanner-contract.schema.json` (campos obrigatórios, tipos e limites). Num erro, o
  código conhecido do contrato prevalece sobre a forma do corpo (ver
  `Rampa.Scanner.Contract.scanner_error/2`).
  """

  @behaviour Rampa.Scanner.Client

  alias Rampa.Scanner.Contract

  # O scanner encerra toda análise em 90 s (`SCAN_TOTAL_TIMEOUT_MS`, RF-RA002) e responde
  # `timeout`. Os 10 s a mais cobrem fechar o contexto do navegador e transferir a resposta:
  # assim o erro chega com o código do scanner, e não como falta de resposta (`unavailable`).
  @scan_receive_timeout 100_000

  @impl true
  def health do
    case Req.get(base_url() <> "/health", req_options(retry: false, receive_timeout: 2_000)) do
      {:ok, %Req.Response{status: 200}} -> :ok
      {:ok, %Req.Response{status: status}} -> {:error, {:http_status, status}}
      {:error, exception} -> {:error, exception}
    end
  end

  @impl true
  def scan(url) when is_binary(url) do
    options = req_options(json: %{url: url}, retry: false, receive_timeout: @scan_receive_timeout)

    case Req.post(base_url() <> "/scan", options) do
      {:ok, %Req.Response{status: 200, body: body}} ->
        with :ok <- Contract.check_response(body), do: {:ok, body}

      {:ok, %Req.Response{status: status, body: body}} ->
        case Contract.scanner_error(status, body) do
          {:ok, error} -> {:error, error}
          {:error, failure} -> {:error, failure}
          :unknown -> outside_contract(status)
        end

      {:error, exception} ->
        unavailable(Exception.message(exception))
    end
  end

  # Erro sem código do contrato: 4xx é um pedido recusado (do lado do backend, definitivo);
  # o resto, scanner indisponível.
  defp outside_contract(status) when status in 400..499,
    do: {:error, %{code: :invalid_request, detail: "scanner recusou o pedido: HTTP #{status}"}}

  defp outside_contract(status), do: unavailable("scanner respondeu HTTP #{status}")

  defp unavailable(detail), do: {:error, %{code: :unavailable, detail: detail}}

  defp base_url, do: Application.fetch_env!(:rampa, :scanner_url)

  # Nos testes, `:scanner_req_options` aponta o Req para um `Req.Test`, sem rede.
  defp req_options(options),
    do: Keyword.merge(options, Application.get_env(:rampa, :scanner_req_options, []))
end
