import Fastify, { type FastifyInstance } from "fastify";
import { errors, type Browser } from "playwright";

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
        const result: ScanResult = {
          final_url: page.url(),
          http_status: response?.status() ?? null,
          title: await page.title(),
        };
        return result;
      } catch (error) {
        if (error instanceof errors.TimeoutError) {
          return reply.code(504).send({ error: "timeout", detail: error.message });
        }
        const detail = error instanceof Error ? error.message : String(error);
        return reply.code(502).send({ error: "navigation_failed", detail });
      } finally {
        await context.close();
      }
    },
  );

  return app;
}
