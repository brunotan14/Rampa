import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import type { FastifyInstance } from "fastify";
import { launchBrowser } from "../src/browser.js";
import { buildServer, type ScanResult, type ServerOptions } from "../src/server.js";
import { fixturesPolicy } from "./support/policy.js";

const fixturesDir = new URL("./fixtures/", import.meta.url);

// Resultado esperado de cada fixture (`<nome>.expected.json`). `violations` é comparação
// exata (regra, impacto e número de nós); `incomplete` é "contém pelo menos".
interface Expected {
  title: string;
  http_status: number;
  blocked_requests: number;
  violations: { id: string; impact: string; nodes: number }[];
  incomplete: { id: string; nodes: number }[];
}

const fixtureNames = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".html"))
  .map((file) => file.replace(/\.html$/, ""))
  .sort();

let browser: Browser;
let app: FastifyInstance;
let fixtures: Server;
let fixturesUrl: string;
let fixturesPort: number;
// Respostas que nunca terminam (rota `/__lento`), encerradas no fim dos testes.
const hanging = new Set<import("node:http").ServerResponse>();

beforeAll(async () => {
  fixtures = createServer(async (req, res) => {
    if (req.url === "/__lento") {
      // Documento que não chega: segura a navegação até o prazo total estourar.
      hanging.add(res);
      return;
    }
    try {
      const body = await readFile(new URL(`.${req.url}`, fixturesDir));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end("<title>Não encontrada</title>");
    }
  });
  await new Promise<void>((resolve) => fixtures.listen(0, "127.0.0.1", resolve));
  fixturesPort = (fixtures.address() as AddressInfo).port;
  // `fixtures` é liberado pela allowlist e resolve para 127.0.0.1, como no Compose de teste.
  fixturesUrl = `http://fixtures:${fixturesPort}`;

  browser = await launchBrowser();
  app = buildServer(browser, serverOptions());
});

const serverOptions = (options: ServerOptions = {}): ServerOptions => ({
  ssrf: fixturesPolicy(fixturesPort),
  ...options,
});

afterAll(async () => {
  for (const res of hanging) res.destroy();
  await app.close();
  await browser.close();
  fixtures.close();
});

async function scan(url: string) {
  return app.inject({ method: "POST", url: "/scan", payload: { url } });
}

describe("GET /health", () => {
  it("responde ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("fixtures", () => {
  it("existem e cada uma tem o seu .expected.json", () => {
    expect(fixtureNames).toEqual(expect.arrayContaining(["contraste-incerto", "img-sem-alt", "limpa"]));
    for (const name of fixtureNames) {
      expect(() => readFileSync(new URL(`${name}.expected.json`, fixturesDir)), name).not.toThrow();
    }
  });

  it.each(fixtureNames)("%s não carrega recurso externo", (name) => {
    const html = readFileSync(new URL(`${name}.html`, fixturesDir), "utf8");
    // Só `href` de link pode apontar para fora; nada que o navegador baixe sozinho.
    expect(html).not.toMatch(/(src|srcset|data|poster)\s*=\s*["']?\s*(https?:)?\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?\s*(https?:)?\/\//i);
    expect(html).not.toMatch(/@import/i);
  });
});

describe("POST /scan com cada fixture", () => {
  it.each(fixtureNames)("%s produz os fatos esperados", async (name) => {
    const expected = JSON.parse(
      readFileSync(new URL(`${name}.expected.json`, fixturesDir), "utf8"),
    ) as Expected;

    const res = await scan(`${fixturesUrl}/${name}.html`);
    expect(res.statusCode).toBe(200);
    const body = res.json<ScanResult>();

    expect(body.final_url).toBe(`${fixturesUrl}/${name}.html`);
    expect(body.title).toBe(expected.title);
    expect(body.http_status).toBe(expected.http_status);
    expect(body.blocked_requests).toBe(expected.blocked_requests);
    expect(body.axe.version).toMatch(/^4\.\d+\.\d+/);

    const violations = body.axe.violations
      .map((rule) => ({ id: rule.id, impact: rule.impact, nodes: rule.nodes.length }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const expectedViolations = [...expected.violations].sort((a, b) => a.id.localeCompare(b.id));
    expect(violations).toEqual(expectedViolations);

    const incomplete = body.axe.incomplete.map((rule) => ({ id: rule.id, nodes: rule.nodes.length }));
    for (const rule of expected.incomplete) {
      expect(incomplete).toContainEqual(rule);
    }
  });
});

describe("POST /scan", () => {
  it("envia só os campos do contrato para cada regra e nó do axe", async () => {
    const res = await scan(`${fixturesUrl}/img-sem-alt.html`);
    const { axe } = res.json<ScanResult>();

    expect(Object.keys(axe).sort()).toEqual(["incomplete", "version", "violations"]);
    const rule = axe.violations.find((r) => r.id === "image-alt");
    expect(rule).toBeDefined();
    expect(Object.keys(rule!).sort()).toEqual(
      ["description", "help", "helpUrl", "id", "impact", "nodes", "tags"].sort(),
    );
    expect(rule!.tags).toEqual(expect.arrayContaining(["wcag2a", "wcag111"]));

    const node = rule!.nodes[0]!;
    expect(Object.keys(node).sort()).toEqual(["failureSummary", "html", "impact", "target"]);
    expect(node.target).toEqual(["img"]);
    expect(node.html).toMatch(/^<img /);
    expect(node.impact).toBe("critical");
    expect(typeof node.failureSummary).toBe("string");
  });

  it("recusa URL que não é http ou https", async () => {
    const res = await scan("ftp://exemplo.com");
    expect(res.statusCode).toBe(400);
  });

  it("devolve http_error sem rodar o axe quando a página responde com erro", async () => {
    const res = await scan(`${fixturesUrl}/nao-existe.html`);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "http_error", detail: "HTTP 404" });
  });

  it("devolve navigation_failed quando a página não abre", async () => {
    // Nome público que o DNS de teste não resolve.
    const res = await scan(`http://nao-resolve.exemplo.com:${fixturesPort}/`);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "navigation_failed", detail: "getaddrinfo ENOTFOUND nao-resolve.exemplo.com" });
  });

  it("devolve navigation_failed quando a conexão é recusada", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const offline = buildServer(browser, { ssrf: fixturesPolicy(port) });
    try {
      const res = await offline.inject({ method: "POST", url: "/scan", payload: { url: `http://fixtures:${port}/` } });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe("navigation_failed");
      expect(res.json().detail).toMatch(/ECONNREFUSED/);
    } finally {
      await offline.close();
    }
  });
});

describe("limite total da análise", () => {
  it("devolve timeout e fecha o contexto quando a análise passa do limite", async () => {
    const quick = buildServer(browser, serverOptions({ totalTimeoutMs: 500 }));
    try {
      const started = Date.now();
      const res = await quick.inject({ method: "POST", url: "/scan", payload: { url: `${fixturesUrl}/__lento` } });

      expect(res.statusCode).toBe(504);
      expect(res.json()).toEqual({ error: "timeout", detail: "análise passou de 500 ms" });
      expect(Date.now() - started).toBeLessThan(5_000);
      // O contexto foi fechado: a navegação pendente foi abortada.
      expect(browser.contexts()).toHaveLength(0);
    } finally {
      await quick.close();
    }
  });

  it("não interfere numa análise que termina dentro do prazo", async () => {
    const quick = buildServer(browser, serverOptions({ totalTimeoutMs: 20_000 }));
    try {
      const res = await quick.inject({ method: "POST", url: "/scan", payload: { url: `${fixturesUrl}/limpa.html` } });
      expect(res.statusCode).toBe(200);
    } finally {
      await quick.close();
    }
  });
});

describe("falha depois da navegação", () => {
  it("devolve analysis_failed quando a coleta quebra com a página já aberta", async () => {
    const broken = buildServer(
      browser,
      serverOptions({
        analyze: async () => {
          throw new Error("Execution context was destroyed");
        },
      }),
    );
    try {
      const res = await broken.inject({ method: "POST", url: "/scan", payload: { url: `${fixturesUrl}/limpa.html` } });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: "analysis_failed", detail: "Execution context was destroyed" });
      expect(browser.contexts()).toHaveLength(0);
    } finally {
      await broken.close();
    }
  });
});
