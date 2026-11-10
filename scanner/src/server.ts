import Fastify, { type FastifyInstance } from "fastify";
import { errors, type Browser, type BrowserContext, type Page } from "playwright";
import { runAxe, type AxeFacts } from "./axe.js";

// Serviço sem estado (PRD §7): recebe uma URL e devolve fatos sobre a página.
// O bloqueio de endereços internos (RF-RA002) entra no M1; até lá o scanner só
// escuta em localhost no ambiente de desenvolvimento.

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
}

// `timeout`: a página não carregou em 30 s ou a análise passou do limite total.
// `navigation_failed`: a página não abriu. `http_error`: o documento respondeu >= 400.
// `analysis_failed`: a página abriu, mas a coleta falhou depois (axe, título, contexto
// destruído por um redirecionamento feito por script).
export type ScanErrorCode = "timeout" | "http_error" | "navigation_failed" | "analysis_failed";

export interface ScanError {
  error: ScanErrorCode;
  detail: string;
}

export interface ServerOptions {
  // Tempo máximo de uma análise, da abertura da página à resposta.
  totalTimeoutMs?: number;
  // Coleta do axe; substituível nos testes.
  analyze?: (page: Page) => Promise<AxeFacts>;
}

type Outcome = { code: 200; body: ScanResult } | { code: 502 | 504; body: ScanError };

const fail = (code: 502 | 504, error: ScanErrorCode, detail: string): Outcome => ({
  code,
  body: { error, detail },
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function buildServer(browser: Browser, options: ServerOptions = {}): FastifyInstance {
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const analyze = options.analyze ?? runAxe;
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  // Nunca rejeita: todo erro vira um `Outcome`. Depois que o prazo total estoura e o
  // contexto é fechado, o erro que isso provoca aqui é descartado.
  async function scan(context: BrowserContext, url: string): Promise<Outcome> {
    let page: Page;
    let status: number | null;
    try {
      page = await context.newPage();
      const response = await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
      status = response?.status() ?? null;
    } catch (error) {
      if (error instanceof errors.TimeoutError) return fail(504, "timeout", error.message);
      return fail(502, "navigation_failed", message(error));
    }

    // Página de erro não é auditada: o axe acharia problemas da página de erro, não do site.
    if (status !== null && status >= 400) return fail(502, "http_error", `HTTP ${status}`);

    try {
      const result: ScanResult = {
        final_url: page.url(),
        http_status: status,
        title: await page.title(),
        axe: await analyze(page),
      };
      return { code: 200, body: result };
    } catch (error) {
      return fail(502, "analysis_failed", message(error));
    }
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
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<Outcome>((resolve) => {
        timer = setTimeout(
          () => resolve(fail(504, "timeout", `análise passou de ${totalTimeoutMs} ms`)),
          totalTimeoutMs,
        );
      });
      let outcome: Outcome;
      try {
        outcome = await Promise.race([scan(context, request.body.url), deadline]);
      } finally {
        clearTimeout(timer);
        // Fechar o contexto aborta a navegação ou o axe que ainda estiverem rodando, e
        // acontece antes da resposta: quando o backend recebe, a memória já foi liberada.
        await context.close();
      }
      return reply.code(outcome.code).send(outcome.body);
    },
  );

  return app;
}
