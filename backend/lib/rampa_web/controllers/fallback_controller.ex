defmodule RampaWeb.FallbackController do
  @moduledoc """
  Converte os erros do domínio em respostas HTTP no formato do PRD §9
  (`RampaWeb.ErrorJSON.error/3`). Status de cada código:

    * 400 `invalid_body`: corpo sem `url` em texto;
    * 404 `audit_not_found`;
    * 409 `idempotency_conflict`: corrida rara entre duas requisições com a mesma chave;
    * 422: recusas da URL (`unsupported_scheme`, `invalid_url`, `blocked_address`,
      `unresolvable`), `invalid_page_limit`, `invalid_idempotency_key` e os parâmetros dos
      achados (`invalid_filter`, `invalid_limit`, `invalid_cursor`);
    * 429 `rate_limited` e `daily_limit_reached`, com o cabeçalho `Retry-After` (segundos) e
      o campo `retry_after` (ISO 8601, UTC) no erro;
    * 503 `dns_error`: o resolvedor falhou, o que pode ser passageiro.
  """

  use RampaWeb, :controller

  require Logger

  alias RampaWeb.ErrorJSON

  @unprocessable [
    :unsupported_scheme,
    :invalid_url,
    :blocked_address,
    :unresolvable,
    :invalid_page_limit,
    :invalid_idempotency_key,
    :invalid_filter,
    :invalid_limit,
    :invalid_cursor
  ]

  def call(conn, {:error, code}) when code in @unprocessable,
    do: respond(conn, :unprocessable_entity, ErrorJSON.error(code))

  def call(conn, {:error, :invalid_body}),
    do: respond(conn, :bad_request, ErrorJSON.error(:invalid_body))

  def call(conn, {:error, :audit_not_found}),
    do: respond(conn, :not_found, ErrorJSON.error(:audit_not_found))

  def call(conn, {:error, :idempotency_conflict}),
    do: respond(conn, :conflict, ErrorJSON.error(:idempotency_conflict))

  def call(conn, {:error, :dns_error}),
    do: respond(conn, :service_unavailable, ErrorJSON.error(:dns_error))

  def call(conn, {:error, {code, %DateTime{} = retry_at}})
      when code in [:rate_limited, :daily_limit_reached] do
    seconds = max(DateTime.diff(retry_at, DateTime.utc_now()), 1)

    conn
    |> put_resp_header("retry-after", Integer.to_string(seconds))
    |> respond(
      :too_many_requests,
      ErrorJSON.error(code, [retry_at: retry_at], %{retry_after: DateTime.to_iso8601(retry_at)})
    )
  end

  def call(conn, {:error, reason}) do
    Logger.error("API: erro inesperado: #{inspect(reason)}")
    respond(conn, :internal_server_error, ErrorJSON.error(:internal_error))
  end

  defp respond(conn, status, body) do
    conn
    |> put_status(status)
    |> json(body)
  end
end
