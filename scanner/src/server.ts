import Fastify, { type FastifyInstance } from "fastify";
import { errors, type Browser, type BrowserContext, type Page } from "playwright";
import { runAxe, type AxeFacts } from "./axe.js";
import { DEFAULT_LIMITS, type FetchLimits } from "./ssrf/fetch.js";
import { interceptRequests, type InterceptState } from "./ssrf/intercept.js";
import { checkUrl, defaultPolicy, type SsrfPolicy } from "./ssrf/policy.js";

// Serviço sem estado (PRD §7): recebe uma URL e devolve fatos sobre a página.
// Toda requisição da página passa pela proteção contra SSRF (RF-RA002, `ssrf/`), e o
// navegador precisa vir de `launchBrowser`, que tira do Chromium a saída de rede própria.

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
  // Sub-recursos (imagem, script, fetch, iframe) recusados pela proteção contra SSRF.
  blocked_requests: number;
}

// `blocked_address`: a URL, um redirecionamento do documento ou uma navegação do documento
// principal vai para endereço proibido (HTTP 422).
// `timeout`: a página não carregou em 30 s ou a análise passou do limite total.
// `navigation_failed`: a página não abriu. `http_error`: o documento respondeu >= 400.
// `analysis_failed`: a página abriu, mas a coleta falhou depois (axe, título, contexto
// destruído por um redirecionamento feito por script).
export type ScanErrorCode =
  | "blocked_address"
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
  // testes trocam o DNS e as portas do documento para usar um servidor local.
  ssrf?: Partial<SsrfPolicy>;
  // Limites por recurso buscado no Node.
  limits?: Partial<FetchLimits>;
}

type Outcome = { code: 200; body: ScanResult } | { code: 422 | 502 | 504; body: ScanError };

const fail = (code: 422 | 502 | 504, error: ScanErrorCode, detail: string): Outcome => ({
  code,
  body: { error, detail },
});

const blocked = (detail: string) => fail(422, "blocked_address", detail);

// Redirecionamentos do documento principal seguidos ao abrir a página.
const MAX_DOCUMENT_REDIRECTS = 10;

type Opened = { status: number | null } | { outcome: Outcome };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function buildServer(browser: Browser, options: ServerOptions = {}): FastifyInstance {
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const analyze = options.analyze ?? runAxe;
  const policy = defaultPolicy(options.ssrf);
  const limits: FetchLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  // Abre a página seguindo os redirecionamentos do documento um a um: cada salto é uma
  // navegação nova, que passa pela proteção contra SSRF (ver `ssrf/intercept.ts`). Os 30 s
  // valem para a abertura inteira, com todos os saltos.
  async function open(page: Page, url: string, state: InterceptState): Promise<Opened> {
    const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
    let target = url;
    for (let redirects = 0; ; redirects++) {
      state.documentRedirect = null;
      state.documentError = null;
      const timeout = deadline - Date.now();
      if (timeout <= 0) return { outcome: fail(504, "timeout", `página não carregou em ${NAVIGATION_TIMEOUT_MS} ms`) };

      let status: number | null;
      try {
        const response = await page.goto(target, { waitUntil: "load", timeout });
        status = response?.status() ?? null;
      } catch (error) {
        if (state.documentBlocked !== null) return { outcome: blocked(state.documentBlocked) };
        if (error instanceof errors.TimeoutError) return { outcome: fail(504, "timeout", error.message) };
        return { outcome: fail(502, "navigation_failed", state.documentError ?? message(error)) };
      }

      if (state.documentRedirect === null) return { status };
      if (redirects >= MAX_DOCUMENT_REDIRECTS) {
        return { outcome: fail(502, "navigation_failed", `mais de ${MAX_DOCUMENT_REDIRECTS} redirecionamentos`) };
      }
      target = state.documentRedirect;
    }
  }

  // Nunca rejeita: todo erro vira um `Outcome`. Depois que o prazo total estoura e o
  // contexto é fechado, o erro que isso provoca aqui é descartado.
  async function scan(context: BrowserContext, url: string, signal: AbortSignal): Promise<Outcome> {
    let page: Page | undefined;
    let state: InterceptState;
    let status: number | null;
    try {
      state = await interceptRequests(context, () => page, policy, limits, signal);
      page = await context.newPage();
      const opened = await open(page, url, state);
      if ("outcome" in opened) return opened.outcome;
      status = opened.status;
      state.opening = false;
    } catch (error) {
      return fail(502, "navigation_failed", message(error));
    }

    // Página de erro não é auditada: o axe acharia problemas da página de erro, não do site.
    if (status !== null && status >= 400) return fail(502, "http_error", `HTTP ${status}`);

    let result: ScanResult;
    try {
      result = {
        final_url: page.url(),
        http_status: status,
        title: await page.title(),
        axe: await analyze(page),
        blocked_requests: 0,
      };
    } catch (error) {
      if (state.documentBlocked !== null) return blocked(state.documentBlocked);
      return fail(502, "analysis_failed", message(error));
    }

    // A página tentou navegar para endereço proibido depois de aberta: o que foi analisado
    // pode ser a página de erro do navegador, então a varredura não vale.
    if (state.documentBlocked !== null) return blocked(state.documentBlocked);
    return { code: 200, body: { ...result, blocked_requests: state.blockedRequests } };
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
      // Recusa cedo, sem abrir o navegador; a navegação confere de novo, a cada salto.
      const check = checkUrl(request.body.url, policy, "document");
      if (!check.ok) {
        const outcome = blocked(check.detail);
        return reply.code(outcome.code).send(outcome.body);
      }

      // Service worker atenderia requisições sem passar pelo route: fica bloqueado.
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      const abort = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<Outcome>((resolve) => {
        timer = setTimeout(
          () => resolve(fail(504, "timeout", `análise passou de ${totalTimeoutMs} ms`)),
          totalTimeoutMs,
        );
      });
      let outcome: Outcome;
      try {
        outcome = await Promise.race([scan(context, request.body.url, abort.signal), deadline]);
      } finally {
        clearTimeout(timer);
        // Cancela as buscas que o route ainda tiver em andamento no Node.
        abort.abort();
        // Fechar o contexto aborta a navegação ou o axe que ainda estiverem rodando, e
        // acontece antes da resposta: quando o backend recebe, a memória já foi liberada.
        await context.close();
      }
      return reply.code(outcome.code).send(outcome.body);
    },
  );

  return app;
}
