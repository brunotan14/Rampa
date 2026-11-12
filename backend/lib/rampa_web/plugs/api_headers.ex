defmodule RampaWeb.Plugs.ApiHeaders do
  @moduledoc """
  Cabeçalhos de toda resposta da API (RF-RA014, RNF-RA008).

  O id da auditoria no link é a capacidade de leitura do relatório, e as respostas trazem
  trechos de HTML e endereços do site auditado. Por isso:

    * `referrer-policy: no-referrer`: um link seguido a partir da resposta não leva o
      endereço (com o id) para outro site;
    * `x-robots-tag: noindex, nofollow`: relatório não aparece em buscador;
    * `cache-control: no-store`: nada fica em cache compartilhado nem no disco;
    * `x-content-type-options: nosniff`: o JSON nunca é interpretado como outro tipo.

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
  def call(conn, _opts), do: merge_resp_headers(conn, @headers)
end
