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
    * `check/2`: a validação de um corpo de resposta, usada por `Rampa.Scanner.HTTP` antes de
      qualquer gravação.
  """

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

  # Quantos erros de validação entram no `detail` (o resto é contado).
  @max_reported_errors 3

  @type kind :: :response | :error
  @type failure :: %{code: :contract_mismatch | :invalid_scan_result, detail: String.t()}

  @doc "Versão do contrato que o backend fala."
  @spec version() :: String.t()
  def version, do: @version

  @doc "Códigos de erro do scanner, na ordem do `enum` do schema."
  @spec error_codes() :: [atom()]
  def error_codes, do: @error_codes

  @doc "Caminho do schema usado na compilação."
  @spec path() :: String.t()
  def path, do: @path

  @doc """
  Confere um corpo de resposta do scanner: `:response` (HTTP 200) ou `:error` (corpo com um
  código do contrato).

    * `contract_version` ausente ou diferente de `version/0` → `:contract_mismatch`. Durante
      um deploy o scanner e o backend podem estar em versões diferentes por alguns instantes,
      então é tratado como passageiro;
    * mesma versão, mas fora do schema (campo obrigatório faltando, tipo errado, acima de um
      limite) ou corpo que não é objeto → `:invalid_scan_result`. Um formato quebrado não se
      resolve com nova tentativa.
  """
  @spec check(kind(), term()) :: :ok | {:error, failure()}
  def check(kind, body) when kind in [:response, :error] do
    cond do
      not is_map(body) ->
        invalid("corpo da resposta do scanner não é um objeto JSON")

      body["contract_version"] != @version ->
        {:error,
         %{
           code: :contract_mismatch,
           detail:
             "versão do contrato do scanner: recebida #{inspect(body["contract_version"])}, " <>
               "esperada #{inspect(@version)}"
         }}

      true ->
        validate(kind, body)
    end
  end

  defp validate(kind, body) do
    case ExJsonSchema.Validator.validate_fragment(@root, Map.fetch!(@fragments, kind), body) do
      :ok -> :ok
      {:error, errors} -> invalid("resposta do scanner fora do contrato: " <> describe(errors))
    end
  end

  defp describe(errors) do
    shown = errors |> Enum.take(@max_reported_errors) |> Enum.map_join("; ", &describe_error/1)
    rest = length(errors) - @max_reported_errors
    if rest > 0, do: "#{shown} (e mais #{rest})", else: shown
  end

  defp describe_error({message, path}), do: "#{path}: #{message}"

  defp invalid(detail), do: {:error, %{code: :invalid_scan_result, detail: detail}}
end
