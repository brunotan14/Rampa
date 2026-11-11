defmodule RampaWeb.ChannelContract do
  @moduledoc """
  O contrato do canal `audit:<id>` (`shared/channel-events.schema.json`), embutido na
  compilação dos testes. Valida um payload, depois de passar pelo JSON como passaria pelo fio,
  contra a definição do evento (`x-events`) ou do join (`x-join`).
  """

  import ExUnit.Assertions

  @path Path.expand("../../../shared/channel-events.schema.json", __DIR__)
  @external_resource @path

  @schema @path |> File.read!() |> Jason.decode!()
  @root ExJsonSchema.Schema.resolve(@schema)

  @doc "O schema decodificado."
  def schema, do: @schema

  @doc "Nomes dos eventos declarados em `x-events`."
  def event_names, do: Map.keys(@schema["x-events"])

  @doc "Ponteiro da definição de um evento (`\"page_scanned\"`) ou do join (`:join_reply`, `:join_error`)."
  def ref(:join_reply), do: @schema["x-join"]["reply"]
  def ref(:join_error), do: @schema["x-join"]["error"]
  def ref(event) when is_binary(event), do: Map.fetch!(@schema["x-events"], event)

  @doc "Payload como o cliente o recebe: codificado e decodificado em JSON."
  def wire(payload), do: payload |> Jason.encode!() |> Jason.decode!()

  @doc """
  Confere o payload contra a definição e devolve o payload como chega ao cliente (chaves em
  texto). Falha o teste com os erros do schema.
  """
  def assert_contract(kind, payload) do
    decoded = wire(payload)
    fragment = ExJsonSchema.Schema.get_fragment!(@root, ref(kind))

    case ExJsonSchema.Validator.validate_fragment(@root, fragment, decoded) do
      :ok -> decoded
      {:error, errors} -> flunk("payload fora do contrato #{inspect(kind)}: #{inspect(errors)}")
    end
  end
end
