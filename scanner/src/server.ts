import Fastify, { type FastifyInstance } from "fastify";
import { errors, type Browser } from "playwright";
import { runAxe, type AxeFacts } from "./axe.js";

// Serviço sem estado (PRD §7): recebe uma URL e devolve fatos sobre a página.
// O bloqueio de endereços internos (RF-RA002) entra no M1; até lá o scanner só
// escuta em localhost no ambiente de desenvolvimento.

const NAVIGATION_TIMEOUT_MS = 30_000;

interface ScanBody {
  url: string;
}

export interface ScanResult {
  final_url: string;
  http_status: number | null;
  title: string;
  axe: AxeFacts;
}

export type ScanErrorCode = "timeout" | "http_error" | "navigation_failed";

export interface ScanError {
  error: ScanErrorCode;
  detail: string;
}

export function buildServer(browser: Browser): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

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
      try {
        const page = await context.newPage();
        const response = await page.goto(request.body.url, {
          waitUntil: "load",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        const status = response?.status() ?? null;

        // Página de erro não é auditada: o axe acharia problemas da página de erro, não do site.
        if (status !== null && status >= 400) {
          const body: ScanError = { error: "http_error", detail: `HTTP ${status}` };
          return reply.code(502).send(body);
        }

        const result: ScanResult = {
          final_url: page.url(),
          http_status: status,
          title: await page.title(),
          axe: await runAxe(page),
        };
        return result;
      } catch (error) {
        if (error instanceof errors.TimeoutError) {
          const body: ScanError = { error: "timeout", detail: error.message };
          return reply.code(504).send(body);
        }
        const detail = error instanceof Error ? error.message : String(error);
        const body: ScanError = { error: "navigation_failed", detail };
        return reply.code(502).send(body);
      } finally {
        await context.close();
      }
    },
  );

  return app;
}
