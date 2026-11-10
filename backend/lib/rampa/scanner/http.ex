defmodule Rampa.Scanner.HTTP do
  @moduledoc "Implementação do `Rampa.Scanner.Client` que fala HTTP com o serviço scanner."

  @behaviour Rampa.Scanner.Client

  @impl true
  def health do
    case Req.get(base_url() <> "/health", retry: false, receive_timeout: 2_000) do
      {:ok, %Req.Response{status: 200}} -> :ok
      {:ok, %Req.Response{status: status}} -> {:error, {:http_status, status}}
      {:error, exception} -> {:error, exception}
    end
  end

  defp base_url, do: Application.fetch_env!(:rampa, :scanner_url)
end
