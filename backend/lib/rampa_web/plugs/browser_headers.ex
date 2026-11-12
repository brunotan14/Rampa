defmodule RampaWeb.Plugs.BrowserHeaders do
  @moduledoc """
  Cabeçalhos de segurança do HTML da interface, o `index.html` do frontend (RNF-RA008).

    * `content-security-policy`: só a própria origem. O build do Vite não tem script nem
      estilo inline (o `index.html` carrega `/assets/*.js` e `/assets/*.css`), as fontes são
      servidas pelo app (`@fontsource`) e o canal em tempo real usa o websocket da mesma
      origem (`connect-src 'self'` cobre `ws:`/`wss:` do mesmo host, CSP nível 3). Os estilos
      dinâmicos do React (`style={...}`) passam pelo CSSOM, que a CSP não bloqueia;
    * `frame-ancestors 'none'` e `x-frame-options: DENY`: a interface não abre dentro de
      outro site (clickjacking);
    * `referrer-policy: no-referrer`: o id da auditoria no endereço é a capacidade de leitura
      do relatório (RF-RA014), como em `RampaWeb.Plugs.ApiHeaders` e no `<meta>` do
      `index.html`;
    * `x-robots-tag: noindex, nofollow`: o relatório não aparece em buscador;
    * `cache-control: no-cache`: o `index.html` aponta para os arquivos com hash do build
      atual, então é revalidado a cada visita (os de `assets/` ficam em cache, ver
      `RampaWeb.Static`).

  O HSTS sai do `force_ssl` de `config/prod.exs` (só em produção, atrás do Traefik).
  """

  import Plug.Conn

  @behaviour Plug

  @csp Enum.join(
         [
           "default-src 'none'",
           "script-src 'self'",
           "style-src 'self'",
           "img-src 'self'",
           "font-src 'self'",
           "connect-src 'self'",
           "manifest-src 'self'",
           "base-uri 'none'",
           "form-action 'self'",
           "frame-ancestors 'none'"
         ],
         "; "
       )

  @headers [
    {"content-security-policy", @csp},
    {"x-content-type-options", "nosniff"},
    {"x-frame-options", "DENY"},
    {"referrer-policy", "no-referrer"},
    {"x-robots-tag", "noindex, nofollow"},
    {"cross-origin-opener-policy", "same-origin"},
    {"permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"},
    {"cache-control", "no-cache"}
  ]

  @doc "Os cabeçalhos aplicados, para os testes."
  @spec headers() :: [{String.t(), String.t()}]
  def headers, do: @headers

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, _opts), do: merge_resp_headers(conn, @headers)
end
