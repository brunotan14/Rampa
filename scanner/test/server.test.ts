import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import type { FastifyInstance } from "fastify";
import { runAxe } from "../src/axe.js";
import { launchBrowser } from "../src/browser.js";
import { buildServer, type ServerOptions } from "../src/server.js";
import { CONTRACT_LIMITS, CONTRACT_VERSION, type AxeTarget, type ScanResponse } from "../src/contract.gen.js";
import { scanOn } from "./support/contract.js";
import { fixturesPolicy } from "./support/policy.js";

const fixturesDir = new URL("./fixtures/", import.meta.url);

// Resultado esperado de cada fixture (`<nome>.expected.json`). `violations` é comparação
// exata (regra, impacto e número de nós); `incomplete` é "contém pelo menos". `passes`
// (RF-RA017) é conferido por subconjunto: as regras de `passes_include` estão lá e as de
// `passes_exclude` não (a lista exata muda com a versão do axe). `login_wall` (RF-RA028) é
// comparação exata.
interface Expected {
  title: string;
  http_status: number;
  blocked_requests: number;
  login_wall: { password_field: boolean };
  violations: { id: string; impact: string; nodes: number }[];
  incomplete: { id: string; nodes: number }[];
  passes_include: string[];
  passes_exclude: string[];
}

const fixtureNames = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".html"))
  .map((file) => file.replace(/\.html$/, ""))
  .sort();

// Páginas montadas no teste, para os cortes do contrato (`src/contract.ts`).
const LONG_TITLE = "Título ".repeat(200);
const MANY_IMAGES = 30;
const pixel = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
// Redirecionamento (302) dentro do servidor de fixtures: o destino é a página com senha.
const redirects: Record<string, string> = { "/__redireciona-entrar": "/entrar.html" };
const generatedPages: Record<string, string> = {
  "/__titulo-longo": `<!doctype html><html lang="pt-BR"><title>${LONG_TITLE}</title><main><h1>Oi</h1></main>`,
  "/__muitas-imagens": `<!doctype html><html lang="pt-BR"><title>Muitas imagens</title><main><h1>Galeria</h1>${Array.from(
    { length: MANY_IMAGES },
    (_, i) => `<img src="${pixel}" data-i="${i}" width="1" height="1">`,
  ).join("")}</main>`,
};

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
    if (req.url === "/__401") {
      res.writeHead(401, { "content-type": "text/html; charset=utf-8", "www-authenticate": "Basic" }).end("<title>Entre</title>");
      return;
    }
    const location = redirects[req.url ?? ""];
    if (location) {
      res.writeHead(302, { location }).end();
      return;
    }
    const generated = generatedPages[req.url ?? ""];
    if (generated) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(generated);
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
  return scanOn(app, url);
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
    expect(fixtureNames).toEqual(expect.arrayContaining(["alt-misto", "contraste-incerto", "img-sem-alt", "limpa"]));
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
    const body = res.json<ScanResponse>();

    expect(body.final_url).toBe(`${fixturesUrl}/${name}.html`);
    expect(body.title).toBe(expected.title);
    expect(body.http_status).toBe(expected.http_status);
    expect(body.blocked_requests).toBe(expected.blocked_requests);
    expect(body.login_wall).toEqual(expected.login_wall);
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

    const passes = (body.axe.passes ?? []).map((rule) => rule.id);
    expect(passes).toEqual(expect.arrayContaining(expected.passes_include));
    for (const id of expected.passes_exclude) {
      expect(passes).not.toContain(id);
    }
  });
});

describe("POST /scan", () => {
  it("envia só os campos do contrato para cada regra e nó do axe", async () => {
    const res = await scan(`${fixturesUrl}/img-sem-alt.html`);
    const { axe } = res.json<ScanResponse>();

    expect(Object.keys(axe).sort()).toEqual(["incomplete", "passes", "version", "violations"]);
    const passed = axe.passes?.find((r) => r.id === "document-title");
    expect(passed).toBeDefined();
    // Regra aprovada vai sem os nós: nenhum HTML da página.
    expect(Object.keys(passed!).sort()).toEqual(["help", "id", "nodes_total", "tags"]);
    expect(passed!.nodes_total).toBeGreaterThan(0);
    const rule = axe.violations.find((r) => r.id === "image-alt");
    expect(rule).toBeDefined();
    expect(Object.keys(rule!).sort()).toEqual(
      ["description", "help", "helpUrl", "id", "impact", "nodes", "nodes_total", "tags"].sort(),
    );
    expect(rule!.nodes_total).toBe(rule!.nodes.length);
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
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "http_error", detail: "HTTP 404", http_status: 404 });
  });

  it("devolve http_error com o status 401 quando a página pede autenticação (RF-RA028, RF-RA029)", async () => {
    const res = await scan(`${fixturesUrl}/__401`);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "http_error", detail: "HTTP 401", http_status: 401 });
  });

  it("devolve navigation_failed quando a página não abre", async () => {
    // Nome público que o DNS de teste não resolve.
    const res = await scan(`http://nao-resolve.exemplo.com:${fixturesPort}/`);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "navigation_failed", detail: "getaddrinfo ENOTFOUND nao-resolve.exemplo.com" });
  });

  it("devolve navigation_failed quando a conexão é recusada", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const offline = buildServer(browser, { ssrf: fixturesPolicy(port) });
    try {
      const res = await scanOn(offline, `http://fixtures:${port}/`);
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
      const res = await scanOn(quick, `${fixturesUrl}/__lento`);

      expect(res.statusCode).toBe(504);
      expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "timeout", detail: "análise passou de 500 ms" });
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
      const res = await scanOn(quick, `${fixturesUrl}/limpa.html`);
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
      const res = await scanOn(broken, `${fixturesUrl}/limpa.html`);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "analysis_failed", detail: "Execution context was destroyed" });
      expect(browser.contexts()).toHaveLength(0);
    } finally {
      await broken.close();
    }
  });
});

describe("RF-RA028: fatos de barreira de login", () => {
  it("informa o campo de senha visível no destino de um redirecionamento, com a final_url", async () => {
    const res = await scan(`${fixturesUrl}/__redireciona-entrar`);
    expect(res.statusCode).toBe(200);
    const body = res.json<ScanResponse>();
    expect(body.final_url).toBe(`${fixturesUrl}/entrar.html`);
    expect(body.http_status).toBe(200);
    expect(body.login_wall).toEqual({ password_field: true });
  });

  it("deixa o campo de fora quando a checagem falha, sem derrubar a varredura", async () => {
    const broken = buildServer(
      browser,
      serverOptions({
        loginWall: async () => {
          throw new Error("Execution context was destroyed");
        },
      }),
    );
    try {
      const res = await scanOn(broken, `${fixturesUrl}/entrar.html`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty("login_wall");
    } finally {
      await broken.close();
    }
  });

  // O axe roda scripts na página: o fato de login é lido antes, junto com a `final_url`.
  it("lê o campo de senha antes do axe", async () => {
    const mutating = buildServer(
      browser,
      serverOptions({
        analyze: async (page) => {
          await page.evaluate(() => document.querySelectorAll("input[type=password]").forEach((el) => el.remove()));
          return runAxe(page);
        },
      }),
    );
    try {
      const res = await scanOn(mutating, `${fixturesUrl}/entrar.html`);
      expect(res.statusCode).toBe(200);
      expect(res.json<ScanResponse>().login_wall).toEqual({ password_field: true });
    } finally {
      await mutating.close();
    }
  });

  it("não manda nada da página além do booleano", async () => {
    const res = await scan(`${fixturesUrl}/entrar.html`);
    expect(Object.keys(res.json<ScanResponse>().login_wall ?? {})).toEqual(["password_field"]);
  });
});

describe("limites do contrato", () => {
  it("corta o título longo da página", async () => {
    const res = await scan(`${fixturesUrl}/__titulo-longo`);
    expect(res.statusCode).toBe(200);
    const { title } = res.json<ScanResponse>();
    expect(LONG_TITLE.trim().length).toBeGreaterThan(CONTRACT_LIMITS.title);
    expect(title).toBe(LONG_TITLE.trim().slice(0, CONTRACT_LIMITS.title));
  });

  it("devolve só os primeiros nós de uma regra, com o total", async () => {
    const res = await scan(`${fixturesUrl}/__muitas-imagens`);
    expect(res.statusCode).toBe(200);
    const rule = res.json<ScanResponse>().axe.violations.find((r) => r.id === "image-alt");

    expect(rule?.nodes_total).toBe(MANY_IMAGES);
    expect(rule?.nodes).toHaveLength(CONTRACT_LIMITS.nodes);
    expect(rule?.nodes[0]?.html).toContain('data-i="0"');
  });

  it("corta HTML, resumo, seletores e listas que vêm da coleta", async () => {
    const huge = "x".repeat(10_000);
    const node = { target: [huge, Array(20).fill("#host")], html: huge, failureSummary: huge, impact: "serious" as const };
    const rule = {
      id: "color-contrast",
      impact: "serious" as const,
      tags: ["wcag2aa", "wcag143"],
      description: "d",
      help: "h",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.14/color-contrast",
      nodes: Array(500).fill(node),
      nodes_total: 500,
    };
    const big = buildServer(
      browser,
      serverOptions({ analyze: async () => ({ version: "4.14.0", violations: Array(150).fill(rule), incomplete: [] }) }),
    );
    try {
      const res = await scanOn(big, `${fixturesUrl}/limpa.html`);
      expect(res.statusCode).toBe(200);
      const { axe } = res.json<ScanResponse>();
      expect(axe.violations).toHaveLength(CONTRACT_LIMITS.rules);
      const [first] = axe.violations;
      expect(first?.nodes).toHaveLength(CONTRACT_LIMITS.nodes);
      expect(first?.nodes_total).toBe(500);
      expect(first?.nodes[0]?.html).toHaveLength(CONTRACT_LIMITS.html);
      expect(first?.nodes[0]?.failureSummary).toHaveLength(CONTRACT_LIMITS.failureSummary);
      expect(first?.nodes[0]?.target).toEqual([huge.slice(0, CONTRACT_LIMITS.selector), Array(CONTRACT_LIMITS.shadowLevels).fill("#host")]);
      expect(first?.nodes[0]?.target_truncated).toBe(true);
    } finally {
      await big.close();
    }
  });

  it("descarta nó sem o mínimo de target do schema e continua contando em nodes_total", async () => {
    const node = (target: AxeTarget, html: string) => ({ target, html, failureSummary: null, impact: "critical" as const });
    const rule = {
      id: "image-alt",
      impact: "critical" as const,
      tags: ["wcag2a", "wcag111"],
      description: "d",
      help: "h",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.14/image-alt",
      nodes: [
        node([], "sem-target"),
        node([[]], "shadow-vazio"),
        node(["iframe", []], "shadow-vazio-no-iframe"),
        node(["img"], "valido"),
        node([["#host", "img"]], "shadow-valido"),
      ],
      nodes_total: 5,
    };
    const odd = buildServer(
      browser,
      serverOptions({ analyze: async () => ({ version: "4.14.0", violations: [rule], incomplete: [] }) }),
    );
    try {
      // `scanOn` confere a resposta contra o schema estrito.
      const res = await scanOn(odd, `${fixturesUrl}/limpa.html`);
      expect(res.statusCode).toBe(200);
      const [only] = res.json<ScanResponse>().axe.violations;
      expect(only?.nodes.map((n) => n.html)).toEqual(["valido", "shadow-valido"]);
      expect(only?.nodes_total).toBe(5);
    } finally {
      await odd.close();
    }
  });
});
