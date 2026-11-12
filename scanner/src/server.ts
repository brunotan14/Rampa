import Fastify, { type FastifyInstance } from "fastify";
import { errors, type Browser, type BrowserContext, type Page } from "playwright";
import { runAxe } from "./axe.js";
import { scanError, scanResponse } from "./contract.js";
import {
  SCAN_ERROR_STATUS,
  SCAN_REQUEST_SCHEMA,
  type AxeFacts,
  type LoginWallFacts,
  type ScanError,
  type ScanErrorCode,
  type ScanRequest,
  type ScanResponse,
} from "./contract.gen.js";
import { trackDocument, type DocumentTracker } from "./document.js";
import { loginWallFacts } from "./login.js";
import { classifyRequests, type RouteState } from "./ssrf/intercept.js";
import { checkUrl, defaultPolicy, type BlockReason, type SsrfPolicy } from "./ssrf/policy.js";
import { DEFAULT_PROXY_LIMITS, startScanProxy, type ProxyLimits, type ScanProxy } from "./ssrf/proxy.js";

// Serviço sem estado (PRD §7): recebe uma URL e devolve fatos sobre a página. O contrato
// (pedido, resposta, erros e limites) é `shared/scanner-contract.schema.json`; os tipos vêm de
// `contract.gen.ts`, gerado dele, e os cortes que mantêm a resposta nos limites, de `contract.ts`.
// Proteção contra SSRF (RF-RA002, `ssrf/`): cada varredura tem um proxy de saída próprio,
// que valida toda conexão, e um route que classifica e conta. O navegador precisa vir de
// `launchBrowser`, que tira do Chromium a saída de rede fora do proxy.

// Limites por página (RF-RA002): 30 s para carregar e 90 s de análise no total.
const NAVIGATION_TIMEOUT_MS = 30_000;
// Janela, depois de aberta a página, para a navegação que ela dispara sozinha terminar.
const SETTLE_WINDOW_MS = 2_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 90_000;

export interface ServerOptions {
  // Tempo máximo de uma análise, da abertura da página à resposta.
  totalTimeoutMs?: number;
  // Prazo para abrir a página (padrão 30 s); menor só nos testes.
  navigationTimeoutMs?: number;
  // Coleta do axe; substituível nos testes.
  analyze?: (page: Page) => Promise<AxeFacts>;
  // Fatos de barreira de login (RF-RA028); substituível nos testes. `undefined` deixa o
  // campo fora da resposta.
  loginWall?: (page: Page) => Promise<LoginWallFacts | undefined>;
  // Proteção contra SSRF. Em produção só a `allowlist` vem de fora (`SSRF_ALLOWLIST`); os
  // testes trocam o DNS e acrescentam às portas a do servidor local.
  ssrf?: Partial<SsrfPolicy>;
  // Teto de dados e de conexões do proxy de cada varredura.
  limits?: Partial<ProxyLimits>;
}

type ErrorStatus = (typeof SCAN_ERROR_STATUS)[ScanErrorCode];
type Outcome = { code: 200; body: ScanResponse } | { code: ErrorStatus; body: ScanError };

// O status HTTP de cada código vem do schema do contrato (`x-http-status`). `httpStatus` é o
// status do documento, só no `http_error` (RF-RA029).
const fail = (error: ScanErrorCode, detail: string, httpStatus?: number): Outcome => ({
  code: SCAN_ERROR_STATUS[error],
  body: scanError(error, detail, httpStatus),
});

// URL recusada pelo `checkUrl`: endereço proibido ou URL inválida.
const refused = (reason: BlockReason, detail: string) =>
  fail(reason === "blocked_address" ? "blocked_address" : "invalid_url", detail);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function buildServer(browser: Browser, options: ServerOptions = {}): FastifyInstance {
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS;
  const analyze = options.analyze ?? runAxe;
  const loginWall = options.loginWall ?? loginWallFacts;
  const policy = defaultPolicy(options.ssrf);
  const limits: ProxyLimits = { ...DEFAULT_PROXY_LIMITS, ...options.limits };
  // Sem log só no Vitest (que define `VITEST`). O `NODE_ENV=test` do Compose de teste mantém
  // o log: é ele que mostra, no `compose.log`, as varreduras e as conexões bloqueadas.
  const app = Fastify({ logger: !process.env.VITEST });

  // Nunca rejeita: todo erro vira um `Outcome`. Depois que o prazo total estoura e o
  // contexto é fechado, o erro que isso provoca aqui é descartado.
  async function scan(context: BrowserContext, proxy: ScanProxy, url: string, scanDeadline: number): Promise<Outcome> {
    let page: Page | undefined;
    let doc: DocumentTracker;
    let route: RouteState;
    try {
      route = await classifyRequests(context, () => page, policy);
      page = await context.newPage();
      doc = trackDocument(page, proxy.token);
    } catch (error) {
      return fail("navigation_failed", message(error));
    }

    // O que invalida a varredura a qualquer momento: documento recusado pelo route, um
    // bloqueio do proxy num salto ou navegação do documento, ou um limite estourado.
    const verdict = (): Outcome | null => {
      if (route.documentBlocked) return refused(route.documentBlocked.reason, route.documentBlocked.detail);
      const block = proxy.blocks.findLast(({ target }) => doc.refusedTargets.has(target));
      if (block) return refused("blocked_address", block.detail);
      if (proxy.limitExceeded !== null) return fail("resource_limit", proxy.limitExceeded);
      return null;
    };
    const documentError = () => [...doc.targets].map((target) => proxy.errors.get(target)).findLast(Boolean);

    try {
      await page.goto(url, { waitUntil: "load", timeout: navigationTimeoutMs });
    } catch (error) {
      const outcome = verdict();
      if (outcome) return outcome;
      if (error instanceof errors.TimeoutError) return fail("timeout", error.message);
      return fail("navigation_failed", documentError() ?? message(error));
    }

    // A página pode navegar sozinha logo depois de abrir (ex.: no `onload`): analisa o destino.
    // A espera tem janela própria, limitada pelo prazo total, e não o que sobrou da abertura.
    const settled = await doc.settle(Math.min(Date.now() + SETTLE_WINDOW_MS, scanDeadline));
    const early = verdict();
    if (early) return early;
    if (!settled) return fail("timeout", `a página continuou navegando por mais de ${SETTLE_WINDOW_MS} ms`);

    const finalUrl = page.url();
    if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
      return fail("navigation_failed", documentError() ?? "a navegação da página falhou depois de aberta");
    }
    // Defesa em profundidade: o proxy já recusou qualquer salto para porta ou endereço
    // proibido, mas a URL final é conferida de novo antes da análise.
    const finalCheck = checkUrl(finalUrl, policy);
    if (!finalCheck.ok) return refused(finalCheck.reason, finalCheck.detail);

    // Página de erro não é auditada: o axe acharia problemas da página de erro, não do site.
    const status = doc.status;
    if (status !== null && status >= 400) return fail("http_error", `HTTP ${status}`, status);

    let facts: { title: string; axe: AxeFacts };
    try {
      facts = { title: await page.title(), axe: await analyze(page) };
    } catch (error) {
      return verdict() ?? fail("analysis_failed", message(error));
    }

    // Num passo à parte, que nunca falha a varredura: sem o fato, o campo fica de fora.
    const login = await loginWall(page).catch(() => undefined);

    const late = verdict();
    if (late) return late;
    // Aqui nenhum bloqueio do proxy é do documento (senão `verdict` teria recusado): todos
    // são de sub-recursos que o route não recusou, então nada é contado duas vezes.
    return {
      code: 200,
      body: scanResponse({
        final_url: finalUrl,
        http_status: status,
        ...facts,
        blocked_requests: route.blockedRequests + proxy.blocks.length,
        ...(login === undefined ? {} : { login_wall: login }),
      }),
    };
  }

  app.get("/health", async () => ({ status: "ok" }));

  // Pedido fora do schema: 400 do Fastify, fora do contrato (o backend trata como
  // `invalid_request`). Campo desconhecido é descartado pelo `removeAdditional` do Fastify.
  app.post<{ Body: ScanRequest }>(
    "/scan",
    { schema: { body: SCAN_REQUEST_SCHEMA } },
    async (request, reply) => {
      // Recusa cedo, sem abrir o navegador; o route e o proxy conferem de novo cada conexão.
      const check = checkUrl(request.body.url, policy);
      if (!check.ok) {
        const outcome = refused(check.reason, check.detail);
        return reply.code(outcome.code).send(outcome.body);
      }

      const startedAt = Date.now();
      const proxy = await startScanProxy(policy, limits);
      let context: BrowserContext | undefined;
      let timer: NodeJS.Timeout | undefined;
      let outcome: Outcome;
      try {
        // Service worker atenderia requisições sem passar pelo route: fica bloqueado.
        context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          proxy: { server: proxy.url },
          serviceWorkers: "block",
          acceptDownloads: false,
        });
        const deadline = new Promise<Outcome>((resolve) => {
          timer = setTimeout(
            () => resolve(fail("timeout", `análise passou de ${totalTimeoutMs} ms`)),
            totalTimeoutMs,
          );
        });
        outcome = await Promise.race([scan(context, proxy, request.body.url, startedAt + totalTimeoutMs), deadline]);
      } finally {
        clearTimeout(timer);
        // Fechar o contexto aborta a navegação ou o axe que ainda estiverem rodando, e
        // acontece antes da resposta: quando o backend recebe, a memória já foi liberada.
        await context?.close();
        await proxy.close();
      }

      if (proxy.blocks.length > 0) {
        request.log.info({ blocked: proxy.blocks.map(({ detail }) => detail) }, "conexões bloqueadas pelo proxy");
      }
      return reply.code(outcome.code).send(outcome.body);
    },
  );

  return app;
}
