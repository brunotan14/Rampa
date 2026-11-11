defmodule Rampa.ErrorCodes do
  @moduledoc """
  Fonte única dos códigos de erro do Rampa. Cada conjunto é definido aqui e só aqui; quem
  precisa dele deriva desta lista:

    * `Rampa.Scanner.HTTP`: os códigos do contrato do scanner (`scanner/0`), que por sua vez
      vêm do `enum` `ScanErrorCode` do schema `shared/scanner-contract.schema.json`
      (`Rampa.Scanner.Contract`);
    * `RampaWeb.ErrorMessages`: a mensagem em português de cada código (`all/0`);
    * `RampaWeb.FallbackController` e `RampaWeb.ErrorJSON`: o status HTTP (`status/1`,
      `http_code/1`);
    * `RampaWeb.Schemas`: os `enum` da especificação OpenAPI (`api/1`, `page/0`).

  O teste de contrato (`test/rampa_web/api_spec_test.exs`) falha se um código daqui não tem
  mensagem própria ou não aparece no `enum` da resposta certa.
  """

  # Contrato do scanner (PRD §7): `{ "error": código }`, do schema canônico.
  @scanner Rampa.Scanner.Contract.error_codes()

  # Acrescentados por `Rampa.Scanner.Client.scan/1`.
  @scanner_client @scanner ++
                    [:invalid_request, :unavailable, :contract_mismatch, :invalid_scan_result]

  # Recusas de `Rampa.Security.URLGuard.validate/2`.
  @url_guard [:invalid_url, :unsupported_scheme, :blocked_address, :unresolvable, :dns_error]

  # `pages.error` e `audits.error`: recusas do `URLGuard` na revalidação, erros do scanner,
  # os do `ScanPageJob` e os do ciclo de vida (`Rampa.Audits`).
  @page Enum.uniq(
          @url_guard ++
            @scanner_client ++ [:internal_error, :stale, :scan_failed]
        )

  # Erros de cada operação da API, com o status HTTP.
  @api %{
    create_audit: [
      invalid_body: 400,
      idempotency_conflict: 409,
      unsupported_scheme: 422,
      invalid_url: 422,
      blocked_address: 422,
      unresolvable: 422,
      invalid_page_limit: 422,
      invalid_idempotency_key: 422,
      idempotency_key_reused: 422,
      rate_limited: 429,
      daily_limit_reached: 429,
      internal_error: 500,
      dns_error: 503
    ],
    get_audit: [audit_not_found: 404],
    list_findings: [
      audit_not_found: 404,
      invalid_filter: 422,
      invalid_limit: 422,
      invalid_cursor: 422
    ]
  }

  # Erros que não passam por controller (rota inexistente, JSON malformado, exceção).
  @http [
    bad_request: 400,
    invalid_body: 400,
    not_found: 404,
    method_not_allowed: 405,
    not_acceptable: 406,
    payload_too_large: 413,
    unsupported_media_type: 415,
    internal_error: 500
  ]

  @statuses @api |> Map.values() |> List.flatten() |> Kernel.++(@http) |> Map.new()

  @type operation :: :create_audit | :get_audit | :list_findings

  @doc "Códigos de erro do contrato do scanner."
  @spec scanner() :: [atom()]
  def scanner, do: @scanner

  @doc "Códigos de `pages.error` e `audits.error`."
  @spec page() :: [atom()]
  def page, do: @page

  @doc "Erros da operação, com o status HTTP."
  @spec api(operation()) :: [{atom(), pos_integer()}]
  def api(operation), do: Map.fetch!(@api, operation)

  @doc "Operações da API com erros documentados."
  @spec operations() :: [operation()]
  def operations, do: Map.keys(@api)

  @doc "Códigos da operação com o status informado."
  @spec api(operation(), pos_integer()) :: [atom()]
  def api(operation, status), do: for({code, ^status} <- api(operation), do: code)

  @doc "Status HTTP de um código da API; `nil` se não é código da API."
  @spec status(atom()) :: pos_integer() | nil
  def status(code), do: Map.get(@statuses, code)

  @doc "Código genérico de um status HTTP sem controller (`bad_request` para outro 4xx)."
  @spec http_code(pos_integer()) :: atom()
  def http_code(status) do
    case List.keyfind(Enum.reject(@http, &(elem(&1, 0) == :invalid_body)), status, 1) do
      {code, ^status} -> code
      nil when status in 400..499 -> :bad_request
      nil -> :internal_error
    end
  end

  @doc "Cada código que pode chegar a uma resposta (e que precisa de mensagem própria)."
  @spec all() :: [atom()]
  def all do
    (@page ++
       Enum.flat_map(@api, fn {_op, errors} -> Keyword.keys(errors) end) ++
       Keyword.keys(@http))
    |> Enum.uniq()
  end
end
