defmodule RampaWeb.FallbackController do
  @moduledoc """
  Converte os erros do domínio em respostas HTTP no formato do PRD §9
  (`RampaWeb.ErrorJSON.error/3`). O status de cada código vem de `Rampa.ErrorCodes`, a
  fonte única. `rate_limited` e `daily_limit_reached` (429) levam o cabeçalho
  `Retry-After` (segundos) e o campo `retry_after` (ISO 8601, UTC) no erro. Erro que não é
  código da API (changeset, por exemplo) vira 500 `internal_error` e vai para o log.
  """

  use RampaWeb, :controller

  require Logger

  alias Rampa.ErrorCodes
  alias RampaWeb.ErrorJSON

  def call(conn, {:error, {code, %DateTime{} = retry_at}})
      when code in [:rate_limited, :daily_limit_reached] do
    seconds = max(DateTime.diff(retry_at, DateTime.utc_now()), 1)

    conn
    |> put_resp_header("retry-after", Integer.to_string(seconds))
    |> respond(
      ErrorCodes.status(code),
      ErrorJSON.error(code, [retry_at: retry_at], %{retry_after: DateTime.to_iso8601(retry_at)})
    )
  end

  def call(conn, {:error, code}) when is_atom(code) and code not in [nil, true, false] do
    case ErrorCodes.status(code) do
      nil -> unexpected(conn, code)
      status -> respond(conn, status, ErrorJSON.error(code))
    end
  end

  def call(conn, {:error, reason}), do: unexpected(conn, reason)

  defp unexpected(conn, reason) do
    Logger.error("API: erro inesperado: #{inspect(reason)}")
    respond(conn, 500, ErrorJSON.error(:internal_error))
  end

  defp respond(conn, status, body) do
    conn
    |> put_status(status)
    |> json(body)
  end
end
