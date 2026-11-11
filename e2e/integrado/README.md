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
- `listFindings(request, id, { filters })`: todos os achados, seguindo o cursor.
- `scanDirect(request, url)`: resposta do scanner, com `blocked_requests` (não é gravado no banco).

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
`limpa.html`, `contraste-incerto.html`; `/` serve a `limpa.html`; caminho inexistente dá 404).
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
