defmodule Rampa.Scanner.Contract do
  @moduledoc """
  Contrato com o scanner (PRD §7), lido do schema canônico
  `shared/scanner-contract.schema.json` (JSON Schema draft-07, validado com `ex_json_schema`).

  O schema é lido e resolvido **na compilação** e fica embutido neste módulo: nada é relido a
  cada resposta e a release não precisa do arquivo em tempo de execução. Por isso o build do
  backend precisa de `shared/` ao lado de `backend/` (no Docker, contexto na raiz do
  repositório, copiando `shared/scanner-contract.schema.json` para `/app/shared/` antes do
  `mix compile`, com o backend em `/app/backend`). Mudou o schema, o módulo é recompilado
  (`@external_resource`).

  Daqui saem:

    * `version/0`: a versão do contrato que o backend fala (`ContractVersion`);
    * `error_codes/0`: os códigos de erro do scanner (`ScanErrorCode`), que alimentam
      `Rampa.ErrorCodes.scanner/0`;
    * `error_statuses/0`: o status HTTP de cada código (`x-http-status`);
    * `check_response/1` e `scanner_error/2`: a interpretação de um corpo de resposta,
      usada por `Rampa.Scanner.HTTP` antes de qualquer gravação.
  """

  require Logger

  @path Path.expand("../../../../shared/scanner-contract.schema.json", __DIR__)
  @external_resource @path

  @schema (case File.read(@path) do
             {:ok, json} ->
               Jason.decode!(json)

             {:error, reason} ->
               raise CompileError,
                 description:
                   "contrato do scanner não encontrado em #{@path} (#{:file.format_error(reason)}): " <>
                     "o build do backend precisa de shared/ ao lado de backend/"
           end)

  @root ExJsonSchema.Schema.resolve(@schema)
  @version get_in(@schema, ["definitions", "ContractVersion", "const"])

  # Lista fixa, lida de um arquivo do repositório na compilação: não cria átomos em execução.
  @error_codes Enum.map(
                 get_in(@schema, ["definitions", "ScanErrorCode", "enum"]),
                 &String.to_atom/1
               )

  # Os dois fragmentos validados, já resolvidos (uma referência inválida quebra a compilação).
  @fragments %{
    response: ExJsonSchema.Schema.get_fragment!(@root, "#/definitions/ScanResponse"),
    error: ExJsonSchema.Schema.get_fragment!(@root, "#/definitions/ScanError")
  }

  # Status HTTP de cada código (`x-http-status`, palavra-chave própria do Rampa no schema).
  @error_statuses Map.new(
                    get_in(@schema, ["definitions", "ScanErrorCode", "x-http-status"]),
                    fn {code, status} -> {String.to_atom(code), status} end
                  )

  @error_codes_by_name Map.new(@error_codes, &{Atom.to_string(&1), &1})

  @detail_max_length get_in(@schema, [
                       "definitions",
                       "ScanError",
                       "properties",
                       "detail",
                       "maxLength"
                     ])

  # Quantos erros de validação entram no `detail` (o resto é contado).
  @max_reported_errors 3

  @type failure :: %{
          code: :unavailable | :contract_mismatch | :invalid_scan_result,
          detail: String.t()
        }

  @doc "Versão do contrato que o backend fala."
  @spec version() :: String.t()
  def version, do: @version

  @doc "Códigos de erro do scanner, na ordem do `enum` do schema."
  @spec error_codes() :: [atom()]
  def error_codes, do: @error_codes

  @doc "Status HTTP de cada código de erro do scanner (`x-http-status` do schema)."
  @spec error_statuses() :: %{atom() => pos_integer()}
  def error_statuses, do: @error_statuses

  @doc "Caminho do schema usado na compilação."
  @spec path() :: String.t()
  def path, do: @path

  @doc """
  Confere o corpo de uma resposta de sucesso (HTTP 200):

    * corpo que não é JSON, ou JSON que não é objeto → `:unavailable` (passageiro): não é uma
      resposta do scanner, e sim de algo no caminho;
    * `contract_version` ausente ou diferente de `version/0` → `:contract_mismatch`
      (passageiro, uma nova tentativa), com `Logger.error` mostrando as duas versões, para a
      divergência duradoura aparecer no log;
    * mesma versão, mas fora do schema (campo obrigatório faltando, tipo errado, acima de um
      limite) → `:invalid_scan_result` (definitivo: um formato quebrado não se resolve com
      nova tentativa).
  """
  @spec check_response(term()) :: :ok | {:error, failure()}
  def check_response(body) when not is_map(body),
    do: failure(:unavailable, "resposta 200 do scanner não é um objeto JSON")

  def check_response(%{"contract_version" => @version} = body) do
    case validate(:response, body) do
      :ok -> :ok
      {:error, detail} -> failure(:invalid_scan_result, detail)
    end
  end

  def check_response(body), do: mismatch(body["contract_version"])

  @doc """
  Interpreta o corpo de uma resposta de erro (HTTP diferente de 200). O código vem primeiro:

    * `"error"` com um código do contrato → `{:ok, %{code, detail}}` com o código real, mesmo
      com a versão ausente ou diferente (só um aviso no log) e mesmo fora do schema: o
      `detail` é cortado no limite do contrato, ou vira `"HTTP <status>"` se faltar;
    * código desconhecido com `contract_version` de outra versão → `:contract_mismatch`;
    * qualquer outra coisa → `:unknown` (o cliente decide pelo status HTTP).
  """
  @spec scanner_error(pos_integer(), term()) ::
          {:ok, %{code: atom(), detail: String.t()}} | {:error, failure()} | :unknown
  def scanner_error(status, %{"error" => name} = body)
      when is_map_key(@error_codes_by_name, name) do
    warn_divergent_version(body["contract_version"], name)

    with {:error, detail} <- validate(:error, body) do
      Logger.warning("erro do scanner fora do contrato (#{name}): #{detail}")
    end

    {:ok, %{code: Map.fetch!(@error_codes_by_name, name), detail: error_detail(body, status)}}
  end

  def scanner_error(_status, %{"contract_version" => version}) when version != @version,
    do: mismatch(version)

  def scanner_error(_status, _body), do: :unknown

  defp error_detail(%{"detail" => detail}, _status) when is_binary(detail),
    do: String.slice(detail, 0, @detail_max_length)

  defp error_detail(_body, status), do: "HTTP #{status}"

  defp warn_divergent_version(@version, _name), do: :ok

  defp warn_divergent_version(version, name) do
    Logger.warning(
      "versão do contrato do scanner divergente num erro #{name}: recebida " <>
        "#{inspect(version)}, esperada #{inspect(@version)}; o código foi respeitado"
    )
  end

  defp mismatch(version) do
    detail =
      "versão do contrato do scanner: recebida #{inspect(version)}, esperada #{inspect(@version)}"

    Logger.error(detail)
    failure(:contract_mismatch, detail)
  end

  defp validate(kind, body) do
    case ExJsonSchema.Validator.validate_fragment(@root, Map.fetch!(@fragments, kind), body) do
      :ok -> :ok
      {:error, errors} -> {:error, "resposta do scanner fora do contrato: " <> describe(errors)}
    end
  end

  defp describe(errors) do
    shown = errors |> Enum.take(@max_reported_errors) |> Enum.map_join("; ", &describe_error/1)
    rest = length(errors) - @max_reported_errors
    if rest > 0, do: "#{shown} (e mais #{rest})", else: shown
  end

  defp describe_error({message, path}), do: "#{path}: #{message}"

  defp failure(code, detail), do: {:error, %{code: code, detail: detail}}
end
