defmodule RampaWeb.Static do
  @moduledoc """
  O build do frontend servido pelo próprio app (PRD §7, Hospedagem e deploy): o Vite gera
  `index.html`, `favicon.svg` e os arquivos com hash em `assets/`, e o `backend/Dockerfile`
  copia tudo para `priv/static` antes do `mix release`.

    * `Plug.Static` (`RampaWeb.Endpoint`) serve os arquivos de `RampaWeb.static_paths/0`.
      Este módulo, como plug logo antes dele, põe os cabeçalhos de `headers/1` na resposta
      200 **e** na 304: o `:headers` do `Plug.Static` (plug 1.20) só vale na 200, e a 304
      sairia com o `cache-control: public` padrão, sem o `immutable`;
    * qualquer outro `GET` fora de `/api` e `/socket` devolve o `index.html`
      (`RampaWeb.SpaController`, com `index/0`), e o React Router decide a tela.

  A pasta vem de `config :rampa, :static_from` (em tempo de compilação, como o
  `Plug.Static`): o app (`priv/static`) por padrão, e uma pasta de teste nos testes
  (`test/support/static`), porque o build não existe no repositório.

  O `index.html` é lido uma vez, na compilação (deste módulo e do `RampaWeb.SpaController`,
  que guarda o conteúdo): o `backend/Dockerfile` copia o build para `priv/static` antes do
  `mix compile`. Sem o build (dev, com a interface no Vite), `index/0`
  devolve `:error`.
  """

  import Plug.Conn

  @behaviour Plug

  @from Application.compile_env(:rampa, :static_from, :rampa)

  # Os arquivos de `assets/` têm o hash do conteúdo no nome (Vite): nunca mudam, então ficam
  # em cache por um ano. Os outros (`favicon.svg`) têm nome fixo e são revalidados.
  @immutable "public, max-age=31536000, immutable"
  @revalidate "public, max-age=0, must-revalidate"

  # Em tempo de compilação, `priv/static` do código-fonte (o `_build` ainda pode não ter o
  # link para ele).
  @index_path Path.join(
                if(is_atom(@from), do: Path.expand("../../priv/static", __DIR__), else: @from),
                "index.html"
              )
  @external_resource @index_path

  @index (case File.read(@index_path) do
            {:ok, body} ->
              hash = :crypto.hash(:sha256, body) |> Base.url_encode64(padding: false)
              {:ok, body, ~s("#{binary_part(hash, 0, 27)}")}

            {:error, _reason} ->
              :error
          end)

  @doc "Origem dos arquivos, no formato da opção `:from` do `Plug.Static`."
  @spec from() :: atom() | String.t()
  def from, do: @from

  @doc """
  O `index.html` do build e o ETag dele (hash do conteúdo), lidos na compilação; `:error` sem
  o build.
  """
  @spec index() :: {:ok, binary(), String.t()} | :error
  def index, do: @index

  @doc """
  Prefixos que nunca caem no `index.html`: a API e o tempo real respondem 404 próprio, e um
  arquivo de `assets/` que não existe é 404 (o navegador não pode receber HTML no lugar de
  um script).
  """
  @spec reserved?([String.t()]) :: boolean()
  def reserved?([segment | _rest]), do: segment in ["api", "socket" | RampaWeb.static_paths()]
  def reserved?([]), do: false

  @doc "Cabeçalhos dos arquivos servidos pelo `Plug.Static`, na 200 e na 304."
  @spec headers(Plug.Conn.t()) :: [{String.t(), String.t()}]
  def headers(%Plug.Conn{path_info: path_info}) do
    cache = if match?(["assets" | _], path_info), do: @immutable, else: @revalidate
    [{"cache-control", cache}, {"x-content-type-options", "nosniff"}]
  end

  @impl Plug
  def init(opts), do: opts

  # Só os caminhos do build; o cabeçalho entra na hora do envio, em 200, 206 e 304.
  @impl Plug
  def call(%Plug.Conn{path_info: [segment | _]} = conn, _opts) do
    if segment in RampaWeb.static_paths() do
      register_before_send(conn, fn
        %Plug.Conn{status: status} = conn when status in [200, 206, 304] ->
          merge_resp_headers(conn, headers(conn))

        conn ->
          conn
      end)
    else
      conn
    end
  end

  def call(conn, _opts), do: conn
end
