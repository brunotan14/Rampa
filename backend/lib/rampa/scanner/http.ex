defmodule Rampa.Scanner.HTTP do
  @moduledoc "Implementação do `Rampa.Scanner.Client` que fala HTTP com o serviço scanner."

  @behaviour Rampa.Scanner.Client

  # A página tem 30 s para carregar e 90 s de análise no total (RF-RA002); a margem cobre o
  # axe e a ida e volta da resposta.
  @scan_receive_timeout 100_000

  @error_codes %{
    "blocked_address" => :blocked_address,
    "timeout" => :timeout,
    "http_error" => :http_error,
    "navigation_failed" => :navigation_failed
  }

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
      {:ok, %Req.Response{status: 200, body: %{"axe" => %{}} = body}} ->
        {:ok, body}

      {:ok, %Req.Response{status: 200}} ->
        unavailable("resposta do scanner fora do contrato")

      {:ok, %Req.Response{status: status, body: %{"error" => code} = body}}
      when is_map_key(@error_codes, code) ->
        {:error, %{code: Map.fetch!(@error_codes, code), detail: detail(body, status)}}

      {:ok, %Req.Response{status: status}} ->
        unavailable("scanner respondeu HTTP #{status}")

      {:error, exception} ->
        unavailable(Exception.message(exception))
    end
  end

  defp detail(%{"detail" => detail}, _status) when is_binary(detail), do: detail
  defp detail(_body, status), do: "HTTP #{status}"

  defp unavailable(detail), do: {:error, %{code: :unavailable, detail: detail}}

  defp base_url, do: Application.fetch_env!(:rampa, :scanner_url)

  # Nos testes, `:scanner_req_options` aponta o Req para um `Req.Test`, sem rede.
  defp req_options(options),
    do: Keyword.merge(options, Application.get_env(:rampa, :scanner_req_options, []))
end
