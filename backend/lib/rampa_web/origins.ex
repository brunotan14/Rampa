defmodule RampaWeb.Origins do
  @moduledoc """
  Origens aceitas no websocket `/socket` em produção (`check_origin`, RF-RA004).

  A origem do app é `https://<PHX_HOST>`. `PHX_ALLOWED_ORIGINS` acrescenta outras, separadas
  por vírgula, cada uma uma origem `http` ou `https` absoluta, sem caminho, usuário, consulta
  nem curinga (ex.: o subdomínio de staging e o domínio próprio, ou os nomes do Compose de
  teste). Valor inválido, ou `*`, impede a subida.

  O valor chega cru de `config/runtime.exs` (`:allowed_origins`) e é interpretado **uma vez
  só**, na subida, e guardado em `:persistent_term`: este módulo é um filho da árvore de
  supervisão, logo antes do `RampaWeb.Endpoint`, que carrega as origens (`load/1`) e não deixa
  processo vivo (`:ignore`). Valor inválido faz `start_link/0` devolver erro, e o app não sobe. O endpoint consulta `allowed?/1` (`check_origin: {RampaWeb.Origins,
  :allowed?, []}`). Em dev (`check_origin: false`, proxy do Vite) e nos testes nada é
  carregado.

  Sem login nem cookie de sessão no canal, a checagem não protege dados de ninguém: impede que
  outro site use o tempo real do Rampa a partir do navegador dos visitantes dele. Cliente fora
  do navegador não manda `Origin` e não é barrado aqui; o limite dele é o do Traefik.
  """

  require Logger

  @key {__MODULE__, :origins}

  @doc """
  Origens aceitas a partir do host do app e da lista extra. Devolve as origens normalizadas
  (`esquema://host[:porta]`, host em minúsculas, porta padrão omitida) ou as entradas
  inválidas.
  """
  @spec parse(String.t() | nil, String.t() | nil) :: {:ok, [String.t()]} | {:error, [String.t()]}
  def parse(host, extra) do
    entries =
      (extra || "")
      |> String.split(",")
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))

    app = if is_binary(host) and host != "", do: normalize("https://" <> host), else: :error
    parsed = Enum.map(entries, &{&1, normalize(&1)})

    case {app, for({entry, :error} <- parsed, do: entry)} do
      {:error, invalid} -> {:error, ["PHX_HOST=#{inspect(host)}" | invalid]}
      {{:ok, app}, []} -> {:ok, Enum.uniq([app | for({_entry, {:ok, o}} <- parsed, do: o)])}
      {_app, invalid} -> {:error, invalid}
    end
  end

  @doc false
  def child_spec(_arg),
    do: %{id: __MODULE__, start: {__MODULE__, :start_link, []}, restart: :transient}

  @doc """
  Carrega as origens de `config :rampa, :allowed_origins` na subida, antes do endpoint.
  Devolve `:ignore` (nenhum processo fica vivo) ou `{:error, {:invalid_allowed_origins,
  motivo}}`, que impede a subida do app.
  """
  @spec start_link() :: :ignore | {:error, {:invalid_allowed_origins, String.t()}}
  def start_link do
    case load(Application.get_env(:rampa, :allowed_origins)) do
      :ok -> :ignore
      {:error, reason} -> {:error, {:invalid_allowed_origins, reason}}
    end
  end

  @doc """
  Carrega as origens na subida. `nil` (dev e testes) não carrega nada. Valor inválido devolve
  `{:error, motivo}`, registrado no log, e o app não sobe.
  """
  @spec load(keyword() | nil) :: :ok | {:error, String.t()}
  def load(nil), do: :ok

  def load(config) when is_list(config) do
    case parse(config[:host], config[:extra]) do
      {:ok, origins} ->
        :persistent_term.put(@key, origins)

      {:error, invalid} ->
        reason =
          "Origens do websocket inválidas (#{Enum.join(invalid, ", ")}). PHX_HOST é " <>
            "obrigatório e PHX_ALLOWED_ORIGINS aceita origens http(s) absolutas separadas " <>
            "por vírgula, como https://rampa.exemplo.com.br, sem curinga."

        Logger.error(reason)
        {:error, reason}
    end
  end

  @doc """
  Diz se a origem da conexão está entre as carregadas. Chamada pelo `check_origin` do
  endpoint com a origem já interpretada. Sem `load/1`, recusa tudo.
  """
  @spec allowed?(URI.t()) :: boolean()
  def allowed?(%URI{} = uri) do
    case normalize(uri) do
      {:ok, origin} -> origin in :persistent_term.get(@key, [])
      :error -> false
    end
  end

  @doc false
  @spec normalize(String.t() | URI.t()) :: {:ok, String.t()} | :error
  def normalize(value) when is_binary(value) do
    if String.contains?(value, "*") do
      :error
    else
      case URI.new(value) do
        {:ok, uri} -> normalize(uri)
        {:error, _part} -> :error
      end
    end
  end

  def normalize(%URI{scheme: scheme, host: host, port: port} = uri)
      when scheme in ["http", "https"] and is_binary(host) and host != "" do
    if uri.userinfo == nil and uri.path in [nil, "", "/"] and uri.query == nil and
         uri.fragment == nil do
      {:ok, "#{scheme}://#{String.downcase(host)}#{port_suffix(scheme, port)}"}
    else
      :error
    end
  end

  def normalize(_invalid), do: :error

  defp port_suffix("https", port) when port in [nil, 443], do: ""
  defp port_suffix("http", port) when port in [nil, 80], do: ""
  defp port_suffix(_scheme, port), do: ":#{port}"
end
