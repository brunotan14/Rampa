defmodule RampaWeb.Plugs.ApiHeaders do
  @moduledoc """
  Cabeçalhos de toda resposta da API, `/api/*` (RF-RA014, RNF-RA008), inclusive as de erro.

  O id da auditoria no link é a capacidade de leitura do relatório, e as respostas trazem
  trechos de HTML e endereços do site auditado. Por isso:

    * `referrer-policy: no-referrer`: um link seguido a partir da resposta não leva o
      endereço (com o id) para outro site;
    * `x-robots-tag: noindex, nofollow`: relatório não aparece em buscador;
    * `cache-control: no-store`: nada fica em cache compartilhado nem no disco;
    * `x-content-type-options: nosniff`: o JSON nunca é interpretado como outro tipo.

  ## Onde é aplicado

  Não fica no pipeline do router: as respostas de erro que não passam por controller (rota
  inexistente, JSON malformado, corpo grande demais, exceção) saem pelo `render_errors` do
  Phoenix com a conexão como ela **entrou** no endpoint, sem o que os plugs puseram depois.
  Por isso `RampaWeb.Endpoint` usa `@before_compile #{inspect(__MODULE__)}`, que envolve o
  `call/2` do endpoint (já com o tratamento de erros) e aplica os cabeçalhos antes de tudo.

  O HTML da interface (`frontend/index.html`) declara o mesmo `referrer` em `<meta>`.
  """

  import Plug.Conn

  @behaviour Plug

  @headers [
    {"referrer-policy", "no-referrer"},
    {"x-robots-tag", "noindex, nofollow"},
    {"cache-control", "no-store"},
    {"x-content-type-options", "nosniff"}
  ]

  @doc "Os cabeçalhos aplicados, para os testes."
  @spec headers() :: [{String.t(), String.t()}]
  def headers, do: @headers

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(%Plug.Conn{path_info: ["api" | _]} = conn, _opts),
    do: merge_resp_headers(conn, @headers)

  def call(conn, _opts), do: conn

  @doc false
  defmacro __before_compile__(_env) do
    quote do
      defoverridable call: 2

      def call(conn, opts), do: conn |> unquote(__MODULE__).call([]) |> super(opts)
    end
  end
end
