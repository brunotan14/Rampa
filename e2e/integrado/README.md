# E2E integrado

Specs que rodam contra o Compose de teste (`infra/docker-compose.test.yml`): app (release),
scanner real, PostgreSQL e o site de fixtures. Cobrem os critérios de aceite do PRD que
dependem do fluxo completo. As telas do Rampa ficam em `../tests/` (`make e2e`).

## Como rodar

```sh
make e2e-integrado                    # ciclo completo: constrói, sobe, roda, derruba
make e2e-integrado ARGS="-g limite"   # com argumentos para o Playwright
make e2e-integrado-up                 # sobe e deixa de pé
make e2e-integrado-run ARGS=...       # roda de novo no ambiente de pé (reconstrói só o runner)
make e2e-integrado-down               # guarda os logs e derruba
```

Os specs rodam **dentro** do serviço `e2e` do Compose: os nomes abaixo não resolvem no host.
Saída em `e2e/test-results/integrado/` (`report/`, `artifacts/` com os traces e `logs/`).

## Endereços (`support/env.ts`)

| Nome | Para quê |
|---|---|
| `env.apiUrl` (`http://app-via-proxy:4000`) | App pela faixa confiável: o `X-Forwarded-For` vale. Padrão dos ajudantes. |
| `env.apiDirectUrl` (`http://app-direct:4000`) | Mesmo app pela faixa **não** confiável: o `X-Forwarded-For` é ignorado. |
| `env.apiDailyUrl` (`http://app-daily-via-proxy:4000`) | Instância com `AUDITS_DAILY_LIMIT=3`, banco próprio. |
| `env.scannerUrl` (`http://scanner:4100`) | Scanner direto (`POST /scan`). |
| `env.fixturesUrl` (`http://fixtures`) | Site de fixtures, como o app e o scanner o enxergam. |
| `env.webUrl` (`http://app-via-proxy:4000`) | Frontend: o build do React servido pelo próprio app (`priv/static`, como em produção), com a CSP e o fallback da SPA, pela faixa confiável. Para os casos que usam o navegador; o IP simulado vai no `X-Forwarded-For` do contexto. |

Use sempre esses nomes, nunca o nome do serviço (`app`): ele resolve em qualquer rede
compartilhada, e a origem da conexão (confiável ou não) deixa de ser previsível.

## Ajudantes (`support/api.ts`)

- `fixtureUrl("img-sem-alt.html")`: URL de uma fixture.
- `newClientIp()`: IP simulado novo (100.64.0.0/10). Cada teste usa os seus.
- `createAudit(request, url, opts)`: `POST /api/audits` que precisa dar 202; devolve `{ id, clientIp }`.
- `postAudit(request, url, opts)`: o mesmo sem conferir, para as recusas; devolve `{ status, body, response, clientIp }`.
  Opções: `clientIp` (padrão: um novo; `null` não envia o cabeçalho), `baseURL`, `idempotencyKey`, `pageLimit`, `body` (corpo cru).
- `apiError(result)`: confere o formato `{ error: { code, message } }` e devolve o `error`.
- `getAudit(request, id)` e `waitForAuditEnd(request, id, { timeoutMs })`: resumo; o segundo espera `completed`, `failed` ou `cancelled` (padrão 60 s).
- `listFindings(request, id, { filters })`: todos os achados, seguindo o cursor (filtros `page_id`, `severity`, `source`, `wcag`, `needs_review`).
- `listPages(request, id)`: as páginas da auditoria (`http_status`, `error`, `login_wall`).
- `getPage(request, id, pageId)` e `getFinding(request, id, findingId)`: o detalhe da página (com `passed_rules`) e o do achado, oráculos das telas do relatório.
- `fixtureHits(request, "instavel/<uuid>")`: quantas vezes uma rota com contador do site de fixtures foi pedida.
- `scanDirect(request, url)`: resposta do scanner, com `blocked_requests` (não é gravado no banco).
- `retryAfterSeconds(result)`: o cabeçalho `Retry-After` de uma recusa 429.

Também em `support/`: `browser.ts` (`openBrowserPage`: contexto do navegador no frontend servido pelo
app, com o IP simulado e sem movimento), `messages.ts` (os textos de `error.message` e, em
`screenTexts`, os da tela que os critérios afirmam),
`time.ts` (`saoPauloTime`, o `HH:MM` das mensagens) e `evidence.ts`. De `../tests/a11y.ts` (o único
arquivo de `tests/` que vai para a imagem do runner): `axeViolations`, `horizontalOverflow` e `TEXT_SPACING`. Todo caso leva a anotação
`requisito` com o texto do critério (`requirement(...)`) e anexa o que mediu
(`attachObserved`); o `afterEach` com `requireObserved` reprova o caso verde sem anexo.

## Specs

| Spec | Cobre |
|---|---|
| `smoke.spec.ts` | Fumaça de ponta a ponta; é o RF-RA003 CA1 (`img-sem-alt.html`) |
| `rf-ra001-iniciar-auditoria.spec.ts` | RF-RA001 CA1 a CA3, com o CA1 também pela tela (formulário → tela de progresso) |
| `rf-ra004-progresso.spec.ts` | RF-RA004 CA1 e CA2 com o canal real (uma página no M2); a queda de conexão (CA3) e as 5 páginas ficam no `make e2e`, com o canal simulado |
| `rf-ra002-protecao-ssrf.spec.ts` | RF-RA002 CA1, CA2, CA3 e CA6 |
| `rf-ra002-limites.spec.ts` | RF-RA002 CA4, `X-Forwarded-For` fora da faixa confiável e teto diário (os dois baldes exclusivos) |
| `rf-ra003-varredura-axe.spec.ts` | RF-RA003 CA2 e `incomplete` com `needs_review = true` |
| `rf-ra028-barreira-login.spec.ts` | RF-RA028 CA1 a CA3 pela API (`login_wall` da página e `login_wall_pages` do resumo) e pela tela (aviso com ícone e texto no resumo e na página, a mensagem do 401 na tela de falha, nenhum aviso na `limpa.html`, com axe), a senha sem redirecionamento, e o RF-RA017 CA1 e CA2 (aba "Aprovados" da `limpa.html`); o CA4 (medição) está nos testes do backend |
| `rf-ra029-falha-acesso.spec.ts` | RF-RA029 CA1 a CA4 pela API (mensagem e `http_status` do 404, nova tentativa no 503, 503 e depois 200, nova auditoria da mesma URL) e CA1, CA4 e CA5 pela tela: mensagem e "Auditar de novo", a nova auditoria com a antiga intacta no link dela, e o 429 com o horário de liberação no fuso do navegador. O 403 pela API (definitivo, um pedido só, `login_wall` nulo) e pela tela (mensagem e "Auditar de novo", sem aviso de login) |
| `rf-ra005-007-relatorio.spec.ts` | RF-RA005, RF-RA006, RF-RA007 e RF-RA017 pelo navegador com a `relatorio-variado.html`, com a API como oráculo: totais confirmados × para confirmar, top 5 e aviso fixo no resumo; filtro de severidade na URL da lista e no link da página; origem e critério WCAG na página; aba "Aprovados"; severidade, seletor e trecho de HTML de cada detalhe. RNF-RA001 nas cinco telas: axe nos temas e mídias do `make e2e`, 320px, zoom de 200% e espaçamento de texto. Com 9 achados não há "Mostrar mais problemas" (a API pagina de 50 em 50) |
| `frontend-servido.spec.ts` | PRD §7 e RNF-RA008: o app serve o build do React (fallback da SPA no link direto) com a CSP, sem violação no navegador do início ao fim da auditoria |

O RF-RA002 CA5 (produção não sobe com a allowlist) e o isolamento de rede do scanner são
provados pelos scripts da seção abaixo, não pelos specs.

## Limites (`support/env.ts`, `limits`)

- `app`: 5 auditorias por hora por IP (o valor do PRD) e teto diário alto. Com IPs simulados
  diferentes por teste, um teste não gasta o limite de outro.
- `env.apiDirectUrl`: todas as requisições contam para um único IP (o do runner na rede não
  confiável). **Só um teste por execução** pode usar esse balde, por exemplo: 5 auditorias com
  `X-Forwarded-For` diferentes e a sexta recebe 429.
- `env.apiDailyUrl`: teto de 3 por dia. **Só um teste por execução** pode usá-lo: 3 criadas, a
  quarta recebe 429 `daily_limit_reached`.
- Sem novas tentativas (`retries: 0`): esses baldes não se repetem. O banco é novo a cada
  `make e2e-integrado`; com o ambiente de pé, os baldes se acumulam entre execuções.

## Fixtures

Em `http://fixtures/`: as páginas de `scanner/test/fixtures/` (`img-sem-alt.html`,
`limpa.html`, `contraste-incerto.html`, `entrar.html` com campo de senha, `senha-escondida.html`,
`relatorio-variado.html` com achados das quatro severidades e dois para confirmar;
`/` serve a `limpa.html`; caminho inexistente dá 404) e as rotas do RF-RA028 e do RF-RA029
(`infra/test/fixtures-nginx.conf`; as com contador em `infra/test/fixtures-njs.js`):

| Caminho | O que faz |
|---|---|
| `painel` | 302 para `/entrar.html` (tela com campo de senha) |
| `restrito` | 401 |
| `instavel/<uuid>` | 503 na primeira visita, depois a `img-sem-alt.html` (200) |
| `sempre-503/<uuid>` | 503 sempre |
| `proibido/<uuid>` | 403 sempre (falha definitiva: o contador prova que não houve nova tentativa) |
| `instavel/<uuid>/hits`, `sempre-503/<uuid>/hits`, `proibido/<uuid>/hits` | `{"hits": N}`: quantas vezes o documento foi pedido |

Use um UUID novo por teste nas rotas com contador. No Compose de teste a nova tentativa da
varredura sai 1 s depois da falha passageira (`config/e2e.exs`).

Em `http://fixtures/ssrf/` (`fixtures/` desta pasta e `infra/test/fixtures-nginx.conf`):

| Caminho | O que faz | Resultado observado |
|---|---|---|
| `ssrf/redireciona-loopback` | 302 para `http://127.0.0.1/` | auditoria `failed`, `error.code = blocked_address`, `pages_failed = 1` |
| `ssrf/redireciona-postgres` | 302 para `http://postgres/` | idem |
| `ssrf/redireciona-limpa` | 302 para `/limpa.html` (controle) | `completed`, sem achados |
| `ssrf/img-ip-privado.html` | `<img src="http://192.168.0.1/x.png">` com `alt`, e um botão sem nome | `completed` com `button-name` (crítico, 4.1.2); no scanner direto, `blocked_requests = 1` |

Nome privado: `interno.rampa.test` resolve para `10.0.0.5` no app e no scanner
(`extra_hosts`), para o critério "um domínio que resolve para 10.0.0.5"
(422 `blocked_address`).

## O que já é verificado fora dos specs

`infra/test/run-e2e.sh` confere, antes dos specs, a recusa da `SSRF_ALLOWLIST` na release de
produção e no scanner de produção (`check-allowlist-prod.sh`) e o isolamento de rede do scanner
em relação ao banco (`check-network-isolation.sh`). Os specs cobrem o lado da API desses
critérios (ex.: `http://postgres/` recusado com 422).
