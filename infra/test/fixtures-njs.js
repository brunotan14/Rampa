// Rotas com estado do container `fixtures` (RF-RA029), em njs no próprio nginx. Cada teste usa
// um UUID novo no caminho, então os contadores de testes paralelos não se misturam. Os
// contadores ficam numa zona compartilhada (`js_shared_dict_zone hits`, em
// `fixtures-nginx.conf`) e somem quando o container é recriado.
//
//   /instavel/<uuid>          503 na primeira visita; depois, a `img-sem-alt.html` (200);
//   /sempre-503/<uuid>        503 sempre;
//   /<rota>/<uuid>/hits       `{"hits": N}`: quantas vezes o documento foi pedido.

const ERROR_PAGE = '<!doctype html><html lang="pt-BR"><title>Indisponível</title><h1>Serviço indisponível</h1></html>';

function count(r) {
  return ngx.shared.hits.incr(r.variables.hit_key, 1, 0);
}

function unavailable(r) {
  r.headersOut['Content-Type'] = 'text/html; charset=utf-8';
  r.return(503, ERROR_PAGE);
}

function unstable(r) {
  if (count(r) === 1) return unavailable(r);
  r.internalRedirect('/img-sem-alt.html');
}

function alwaysUnavailable(r) {
  count(r);
  unavailable(r);
}

function hits(r) {
  r.headersOut['Content-Type'] = 'application/json';
  r.headersOut['Cache-Control'] = 'no-store';
  r.return(200, JSON.stringify({ hits: ngx.shared.hits.get(r.variables.hit_key) || 0 }));
}

export default { unstable, alwaysUnavailable, hits };
