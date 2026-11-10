import Fastify, { type FastifyInstance } from "fastify";
import { errors, type Browser, type BrowserContext, type Page } from "playwright";
import { runAxe, type AxeFacts } from "./axe.js";
import { trackDocument, type DocumentTracker } from "./document.js";
import { classifyRequests, type RouteState } from "./ssrf/intercept.js";
import { checkUrl, defaultPolicy, type BlockReason, type SsrfPolicy } from "./ssrf/policy.js";
import { DEFAULT_PROXY_LIMITS, startScanProxy, type ProxyLimits, type ScanProxy } from "./ssrf/proxy.js";

// Serviço sem estado (PRD §7): recebe uma URL e devolve fatos sobre a página.
// Proteção contra SSRF (RF-RA002, `ssrf/`): cada varredura tem um proxy de saída próprio,
// que valida toda conexão, e um route que classifica e conta. O navegador precisa vir de
// `launchBrowser`, que tira do Chromium a saída de rede fora do proxy.

// Limites por página (RF-RA002): 30 s para carregar e 90 s de análise no total.
const NAVIGATION_TIMEOUT_MS = 30_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 90_000;

interface ScanBody {
  url: string;
}

export interface ScanResult {
  final_url: string;
  http_status: number | null;
  title: string;
  axe: AxeFacts;
  // Requisições recusadas pela proteção contra SSRF fora do documento principal (endereço,
  // nome ou porta): as que o route recusou e as que só o proxy viu (saltos de
  // redirecionamento, WebSocket, workers), cada uma contada uma vez.
  blocked_requests: number;
}

// `blocked_address` (422): a URL, um salto de redirecionamento do documento ou uma navegação
// do documento principal vai para endereço proibido ou porta fora de 80/443.
// `invalid_url` (422): URL com credenciais ou host inválido.
// `resource_limit` (422): a página passou do teto de dados ou de conexões da varredura.
// `timeout` (504): a página não carregou em 30 s ou a análise passou do limite total.
// `navigation_failed` (502): a página não abriu. `http_error` (502): o documento respondeu >= 400.
// `analysis_failed` (502): a página abriu, mas a coleta falhou depois (axe, título).
export type ScanErrorCode =
  | "blocked_address"
  | "invalid_url"
  | "resource_limit"
  | "timeout"
  | "http_error"
  | "navigation_failed"
  | "analysis_failed";

export interface ScanError {
  error: ScanErrorCode;
  detail: string;
}

export interface ServerOptions {
  // Tempo máximo de uma análise, da abertura da página à resposta.
  totalTimeoutMs?: number;
  // Coleta do axe; substituível nos testes.
  analyze?: (page: Page) => Promise<AxeFacts>;
  // Proteção contra SSRF. Em produção só a `allowlist` vem de fora (`SSRF_ALLOWLIST`); os
  // testes trocam o DNS e acrescentam às portas a do servidor local.
  ssrf?: Partial<SsrfPolicy>;
  // Teto de dados e de conexões do proxy de cada varredura.
  limits?: Partial<ProxyLimits>;
}

type Outcome = { code: 200; body: ScanResult } | { code: 422 | 502 | 504; body: ScanError };

const fail = (code: 422 | 502 | 504, error: ScanErrorCode, detail: string): Outcome => ({
  code,
  body: { error, detail },
});

// URL recusada pelo `checkUrl`: endereço proibido ou URL inválida.
const refused = (reason: BlockReason, detail: string) =>
  fail(422, reason === "blocked_address" ? "blocked_address" : "invalid_url", detail);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function buildServer(browser: Browser, options: ServerOptions = {}): FastifyInstance {
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const analyze = options.analyze ?? runAxe;
  const policy = defaultPolicy(options.ssrf);
  const limits: ProxyLimits = { ...DEFAULT_PROXY_LIMITS, ...options.limits };
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  // Nunca rejeita: todo erro vira um `Outcome`. Depois que o prazo total estoura e o
  // contexto é fechado, o erro que isso provoca aqui é descartado.
  async function scan(context: BrowserContext, proxy: ScanProxy, url: string): Promise<Outcome> {
    let page: Page | undefined;
    let doc: DocumentTracker;
    let route: RouteState;
    try {
      route = await classifyRequests(context, () => page, policy);
      page = await context.newPage();
      doc = trackDocument(page, proxy.token);
    } catch (error) {
      return fail(502, "navigation_failed", message(error));
    }

    // O que invalida a varredura a qualquer momento: documento recusado pelo route, um
    // bloqueio do proxy num salto ou navegação do documento, ou um limite estourado.
    const verdict = (): Outcome | null => {
      if (route.documentBlocked) return refused(route.documentBlocked.reason, route.documentBlocked.detail);
      const block = proxy.blocks.findLast(({ target }) => doc.refusedTargets.has(target));
      if (block) return refused("blocked_address", block.detail);
      if (proxy.limitExceeded !== null) return fail(422, "resource_limit", proxy.limitExceeded);
      return null;
    };
    const documentError = () => [...doc.targets].map((target) => proxy.errors.get(target)).findLast(Boolean);

    const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
    try {
      await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      const outcome = verdict();
      if (outcome) return outcome;
      if (error instanceof errors.TimeoutError) return fail(504, "timeout", error.message);
      return fail(502, "navigation_failed", documentError() ?? message(error));
    }

    // A página pode navegar sozinha logo depois de abrir (ex.: no `onload`): analisa o destino.
    const settled = await doc.settle(deadline);
    const early = verdict();
    if (early) return early;
    if (!settled) return fail(504, "timeout", `a página não terminou de carregar em ${NAVIGATION_TIMEOUT_MS} ms`);

    const finalUrl = page.url();
    if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
      return fail(502, "navigation_failed", documentError() ?? "a navegação da página falhou depois de aberta");
    }
    // Defesa em profundidade: o proxy já recusou qualquer salto para porta ou endereço
    // proibido, mas a URL final é conferida de novo antes da análise.
    const finalCheck = checkUrl(finalUrl, policy);
    if (!finalCheck.ok) return refused(finalCheck.reason, finalCheck.detail);

    // Página de erro não é auditada: o axe acharia problemas da página de erro, não do site.
    const status = doc.status;
    if (status !== null && status >= 400) return fail(502, "http_error", `HTTP ${status}`);

    let facts: { title: string; axe: AxeFacts };
    try {
      facts = { title: await page.title(), axe: await analyze(page) };
    } catch (error) {
      return verdict() ?? fail(502, "analysis_failed", message(error));
    }

    const late = verdict();
    if (late) return late;
    // Aqui nenhum bloqueio do proxy é do documento (senão `verdict` teria recusado): todos
    // são de sub-recursos que o route não recusou, então nada é contado duas vezes.
    return {
      code: 200,
      body: {
        final_url: finalUrl,
        http_status: status,
        ...facts,
        blocked_requests: route.blockedRequests + proxy.blocks.length,
      },
    };
  }

  app.get("/health", async () => ({ status: "ok" }));

  app.post<{ Body: ScanBody }>(
    "/scan",
    {
      schema: {
        body: {
          type: "object",
          required: ["url"],
          additionalProperties: true,
          properties: { url: { type: "string", pattern: "^https?://" } },
        },
      },
    },
    async (request, reply) => {
      // Recusa cedo, sem abrir o navegador; o route e o proxy conferem de novo cada conexão.
      const check = checkUrl(request.body.url, policy);
      if (!check.ok) {
        const outcome = refused(check.reason, check.detail);
        return reply.code(outcome.code).send(outcome.body);
      }

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
            () => resolve(fail(504, "timeout", `análise passou de ${totalTimeoutMs} ms`)),
            totalTimeoutMs,
          );
        });
        outcome = await Promise.race([scan(context, proxy, request.body.url), deadline]);
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
