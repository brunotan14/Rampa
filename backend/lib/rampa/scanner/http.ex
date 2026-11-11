defmodule Rampa.Scanner.HTTP do
  @moduledoc """
  Implementação do `Rampa.Scanner.Client` que fala HTTP com o serviço scanner.

  Toda resposta com código do contrato passa por `Rampa.Scanner.Contract.check/2` antes de
  sair daqui, e portanto antes de qualquer gravação: o resultado `{:ok, body}` sempre cumpre
  o schema `shared/scanner-contract.schema.json` (campos obrigatórios, tipos e limites).
  """

  @behaviour Rampa.Scanner.Client

  alias Rampa.Scanner.Contract

  # O scanner encerra toda análise em 90 s (`SCAN_TOTAL_TIMEOUT_MS`, RF-RA002) e responde
  # `timeout`. Os 10 s a mais cobrem fechar o contexto do navegador e transferir a resposta:
  # assim o erro chega com o código do scanner, e não como falta de resposta (`unavailable`).
  @scan_receive_timeout 100_000

  # Códigos do contrato do scanner, da fonte única (`Rampa.ErrorCodes`, derivada do schema).
  @error_codes Map.new(Rampa.ErrorCodes.scanner(), &{Atom.to_string(&1), &1})

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
        with :ok <- Contract.check(:response, body), do: {:ok, body}

      {:ok, %Req.Response{body: %{"error" => code} = body}}
      when is_map_key(@error_codes, code) ->
        with :ok <- Contract.check(:error, body) do
          {:error, %{code: Map.fetch!(@error_codes, code), detail: body["detail"]}}
        end

      {:ok, %Req.Response{status: status}} when status in 400..499 ->
        {:error, %{code: :invalid_request, detail: "scanner recusou o pedido: HTTP #{status}"}}

      {:ok, %Req.Response{status: status}} ->
        unavailable("scanner respondeu HTTP #{status}")

      {:error, exception} ->
        unavailable(Exception.message(exception))
    end
  end

  defp unavailable(detail), do: {:error, %{code: :unavailable, detail: detail}}

  defp base_url, do: Application.fetch_env!(:rampa, :scanner_url)

  # Nos testes, `:scanner_req_options` aponta o Req para um `Req.Test`, sem rede.
  defp req_options(options),
    do: Keyword.merge(options, Application.get_env(:rampa, :scanner_req_options, []))
end
