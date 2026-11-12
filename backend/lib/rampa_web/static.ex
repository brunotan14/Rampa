defmodule RampaWeb.Static do
  @moduledoc """
  O build do frontend servido pelo próprio app (PRD §7, Hospedagem e deploy): o Vite gera
  `index.html`, `favicon.svg` e os arquivos com hash em `assets/`, e o `backend/Dockerfile`
  copia tudo para `priv/static` antes do `mix release`.

    * `Plug.Static` (`RampaWeb.Endpoint`) serve os arquivos de `RampaWeb.static_paths/0`,
      com os cabeçalhos de `headers/1`;
    * qualquer outro `GET` fora de `/api` e `/socket` devolve o `index.html`
      (`RampaWeb.SpaController`), e o React Router decide a tela.

  A pasta vem de `config :rampa, :static_from` (em tempo de compilação, como o
  `Plug.Static`): o app (`priv/static`) por padrão, e uma pasta de teste nos testes
  (`test/support/static`), porque o build não existe no repositório.
  """

  @from Application.compile_env(:rampa, :static_from, :rampa)

  # Os arquivos de `assets/` têm o hash do conteúdo no nome (Vite): nunca mudam, então ficam
  # em cache por um ano. Os outros (`favicon.svg`) têm nome fixo e são revalidados.
  @immutable "public, max-age=31536000, immutable"
  @revalidate "public, max-age=0, must-revalidate"

  @doc "Origem dos arquivos, no formato da opção `:from` do `Plug.Static`."
  @spec from() :: atom() | String.t()
  def from, do: @from

  @doc "Caminho do `index.html` do build."
  @spec index_path() :: String.t()
  def index_path, do: Path.join(root(), "index.html")

  @doc """
  Prefixos que nunca caem no `index.html`: a API e o tempo real respondem 404 próprio, e um
  arquivo de `assets/` que não existe é 404 (o navegador não pode receber HTML no lugar de
  um script).
  """
  @spec reserved?([String.t()]) :: boolean()
  def reserved?([segment | _rest]), do: segment in ["api", "socket" | RampaWeb.static_paths()]
  def reserved?([]), do: false

  @doc "Cabeçalhos dos arquivos servidos pelo `Plug.Static` (opção `:headers`)."
  @spec headers(Plug.Conn.t()) :: [{String.t(), String.t()}]
  def headers(%Plug.Conn{path_info: path_info}) do
    cache = if match?(["assets" | _], path_info), do: @immutable, else: @revalidate
    [{"cache-control", cache}, {"x-content-type-options", "nosniff"}]
  end

  if is_atom(@from) do
    defp root, do: Application.app_dir(@from, "priv/static")
  else
    defp root, do: @from
  end
end
