import { createSocket, type Socket } from "node:dgram";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AxeFacts } from "../src/axe.js";
import { launchBrowser } from "../src/browser.js";
import { buildServer, type ScanResult, type ServerOptions } from "../src/server.js";
import { isBlockedIp } from "../src/ssrf/ip.js";
import type { Resolve } from "../src/ssrf/policy.js";
import { fixturesPolicy, notFound } from "./support/policy.js";
import { startServers, type LocalServers } from "./support/servers.js";

// Bloqueio de requisições no scanner (RF-RA002), com o Chromium de verdade. As páginas
// destes testes ficam aqui, e não em `fixtures/`, porque apontam para endereços proibidos.

const fixturesDir = new URL("./fixtures/", import.meta.url);
const limpa = readFileSync(new URL("limpa.html", fixturesDir));

const html = (title: string, body = "") =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

let servers: LocalServers;
let port: number;
let udp: Socket;
let udpPackets = 0;
let browser: Browser;
let app: FastifyInstance;

const pages = (): Record<string, (cookie: string | undefined) => { status?: number; headers?: Record<string, string | string[]>; body: string | Buffer }> => ({
  "/limpa.html": () => ({ body: limpa }),
  "/redireciona-privado": () => ({ status: 302, headers: { location: "http://127.0.0.1/" }, body: "" }),
  "/redireciona-cadeia": () => ({ status: 301, headers: { location: "/redireciona-privado" }, body: "" }),
  "/redireciona-limpa": () => ({ status: 302, headers: { location: "/limpa.html" }, body: "" }),
  "/redireciona-cookie": () => ({
    status: 302,
    headers: { location: "/precisa-cookie", "set-cookie": ["visto=1; Path=/", "outro=2; Path=/"] },
    body: "",
  }),
  "/precisa-cookie": (cookie) =>
    cookie?.includes("visto=1") && cookie.includes("outro=2")
      ? { body: html("Com cookie") }
      : { status: 403, body: html("Sem cookie") },
  "/laco": () => ({ status: 302, headers: { location: "/laco" }, body: "" }),
  "/img-privada.html": () => ({ body: html("Imagem em IP privado", '<img src="http://192.168.0.1/x.png">') }),
  "/iframe-privado.html": () => ({
    body: html("Iframe em IP privado", '<iframe title="Interno" src="http://10.0.0.5/"></iframe>'),
  }),
  "/fetch-privado.html": () => ({
    body: html(
      "Fetch para IP privado",
      `<script>
        const results = [];
        const done = (r) => { results.push(r); if (results.length === 2) document.title = "fetch:" + results.sort().join(","); };
        fetch("http://127.0.0.1:${port}/segredo").then(() => done("vazou-ip"), () => done("bloqueado-ip"));
        fetch("http://interno.exemplo.com:${port}/segredo").then(() => done("vazou-nome"), () => done("bloqueado-nome"));
      </script>`,
    ),
  }),
  "/navega-privado.html": () => ({
    body: html("Navega para IP privado", `<script>setTimeout(() => { location.href = "http://10.0.0.5/"; }, 50);</script>`),
  }),
  "/sw.html": () => ({
    body: html(
      "Service worker",
      `<script>
        if (!("serviceWorker" in navigator)) document.title = "sw:indisponivel";
        else navigator.serviceWorker.register("/sw.js").then(() => { document.title = "sw:registrado"; }, () => { document.title = "sw:bloqueado"; });
      </script>`,
    ),
  }),
  "/sw.js": () => ({ headers: { "content-type": "text/javascript" }, body: "self.addEventListener('fetch', () => {});" }),
  "/gzip.html": () => ({ headers: { "content-encoding": "gzip" }, body: gzipSync(html("Página com gzip")) }),
  "/br.html": () => ({ headers: { "content-encoding": "br" }, body: brotliCompressSync(html("Página com brotli")) }),
  "/grande.html": () => ({
    body: html(
      "Recursos grandes",
      `<script>
        const get = (path) => fetch(path).then((r) => r.text()).then((t) => "ok:" + t.length, () => "falhou");
        Promise.all([get("/grande.bin"), get("/bomba.bin"), get("/pequeno.txt")]).then((r) => { document.title = r.join(","); });
      </script>`,
    ),
  }),
  "/grande.bin": () => ({ body: Buffer.alloc(100 * 1024, 97) }),
  "/bomba.bin": () => ({ headers: { "content-encoding": "gzip" }, body: gzipSync(Buffer.alloc(4 * 1024 * 1024)) }),
  "/pequeno.txt": () => ({ body: "abc" }),
  "/documento-grande.html": () => ({ body: html("Grande", "x".repeat(100 * 1024)) }),
  "/rebind.html": () => ({
    body: html(
      "Rebinding",
      Array.from({ length: 6 }, (_, i) => `<img alt="" src="http://rebind.exemplo.com:${port}/px.gif?${i}">`).join(""),
    ),
  }),
  "/px.gif": () => ({ headers: { "content-type": "image/gif" }, body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }),
  "/fugas.html": () => ({
    body: html(
      "Fugas do route",
      `<link rel="preconnect" href="http://127.0.0.1:${port}/">
      <script>
        try { new WebSocket("ws://127.0.0.1:${port}/ws"); } catch {}
        try { new WebSocket("ws://fixtures:${port}/ws"); } catch {}
        try {
          const code = "fetch('http://127.0.0.1:${port}/shared').catch(() => {})";
          new SharedWorker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
        } catch {}
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort()}" }] });
        pc.createDataChannel("x");
        pc.createOffer().then((offer) => pc.setLocalDescription(offer));
      </script>`,
    ),
  }),
});

const udpPort = () => (udp.address() as AddressInfo).port;

beforeAll(async () => {
  servers = await startServers((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const page = pages()[path];
    if (!page) return res.writeHead(404, { "content-type": "text/html" }).end(html("Não encontrada"));
    const { status = 200, headers = {}, body } = page(req.headers.cookie);
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers }).end(body);
  });
  port = servers.port;

  udp = createSocket("udp4");
  udp.on("message", () => (udpPackets += 1));
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));

  browser = await launchBrowser();
  app = buildServer(browser, options());
});

afterAll(async () => {
  await app.close();
  await browser.close();
  await servers.close();
  udp.close();
});

// `fixtures` liberado pela allowlist e resolvido para 127.0.0.1; `interno.exemplo.com`
// resolve para 127.0.0.1 e continua proibido.
const resolveTest: Resolve = async (host) => {
  if (host === "fixtures" || host === "interno.exemplo.com") return [{ address: "127.0.0.1", family: 4 }];
  throw notFound(host);
};

function options(overrides: ServerOptions = {}): ServerOptions {
  return { ssrf: fixturesPolicy(port, { resolve: resolveTest }), ...overrides };
}

const url = (path: string) => `http://fixtures:${port}${path}`;
const hitsTo = (path: string) => servers.hits.filter((hit) => hit.url.startsWith(path));

async function scanWith(server: FastifyInstance, target: string) {
  return server.inject({ method: "POST", url: "/scan", payload: { url: target } });
}

const scan = (target: string) => scanWith(app, target);

// `analyze` que espera o script da página trocar o título e guarda o título.
function waitTitle(prefix: string, seen: { title?: string }, extra: (title: string) => boolean = () => true) {
  return async (page: Page): Promise<AxeFacts> => {
    await expectTitle(page, prefix, extra);
    seen.title = await page.title();
    return { version: "4.0.0", violations: [], incomplete: [] };
  };
}

async function expectTitle(page: Page, prefix: string, extra: (title: string) => boolean) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const title = await page.title();
    if (title.startsWith(prefix) && extra(title)) return;
    if (Date.now() > deadline) throw new Error(`título não mudou: ${title}`);
    await page.waitForTimeout(50);
  }
}

describe("documento principal", () => {
  it("URL de endereço proibido é recusada sem abrir o navegador", async () => {
    const res = await scan("http://169.254.169.254/latest/meta-data/");
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "blocked_address", detail: "endereço proibido: 169.254.169.254" });
    expect(browser.contexts()).toHaveLength(0);
  });

  it("porta fora de 80/443 é recusada no documento", async () => {
    const res = await scanWith(buildServer(browser), "http://exemplo.com:8080/");
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "blocked_address", detail: "porta não permitida: 8080" });
  });

  it("página que redireciona para http://127.0.0.1/ devolve blocked_address", async () => {
    const res = await scan(url("/redireciona-privado"));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "blocked_address", detail: "endereço proibido: 127.0.0.1" });
    expect(browser.contexts()).toHaveLength(0);
  });

  it("o bloqueio vale para qualquer salto da cadeia de redirecionamentos", async () => {
    const res = await scan(url("/redireciona-cadeia"));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("blocked_address");
  });

  it("redirecionamento permitido é seguido e a página final é analisada", async () => {
    const res = await scan(url("/redireciona-limpa"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ final_url: url("/limpa.html"), http_status: 200, title: "Página limpa" });
  });

  it("os cookies do redirecionamento chegam ao destino", async () => {
    const res = await scan(url("/redireciona-cookie"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ final_url: url("/precisa-cookie"), title: "Com cookie" });
  });

  it("para depois de 10 redirecionamentos", async () => {
    const res = await scan(url("/laco"));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "navigation_failed", detail: "mais de 10 redirecionamentos" });
  });

  it("navegação do documento para IP proibido depois de aberto devolve blocked_address", async () => {
    const server = buildServer(
      browser,
      options({
        analyze: async (page) => {
          await page.waitForEvent("requestfailed", { predicate: (r) => r.url().startsWith("http://10.0.0.5") });
          return { version: "4.0.0", violations: [], incomplete: [] };
        },
      }),
    );
    try {
      const res = await scanWith(server, url("/navega-privado.html"));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: "blocked_address", detail: "endereço proibido: 10.0.0.5" });
    } finally {
      await server.close();
    }
  });
});

describe("sub-recursos", () => {
  it('a página com <img src="http://192.168.0.1/x.png"> termina, conta o bloqueio e traz os achados do axe', async () => {
    const res = await scan(url("/img-privada.html"));
    expect(res.statusCode).toBe(200);
    const body = res.json<ScanResult>();
    expect(body.blocked_requests).toBeGreaterThanOrEqual(1);
    expect(body.axe.violations.map((rule) => rule.id)).toContain("image-alt");
  });

  it("iframe para IP privado é bloqueado e a varredura continua", async () => {
    const res = await scan(url("/iframe-privado.html"));
    expect(res.statusCode).toBe(200);
    expect(res.json<ScanResult>().blocked_requests).toBeGreaterThanOrEqual(1);
  });

  it("fetch por script para IP privado, literal ou resolvido, é bloqueado", async () => {
    const seen: { title?: string } = {};
    const server = buildServer(browser, options({ analyze: waitTitle("fetch:", seen) }));
    try {
      const res = await scanWith(server, url("/fetch-privado.html"));
      expect(res.statusCode).toBe(200);
      expect(seen.title).toBe("fetch:bloqueado-ip,bloqueado-nome");
      expect(res.json<ScanResult>().blocked_requests).toBe(2);
      // O servidor local é acessível: se a requisição tivesse escapado, ele a teria recebido.
      expect(hitsTo("/segredo")).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("service worker não é registrado", async () => {
    const seen: { title?: string } = {};
    const server = buildServer(browser, options({ analyze: waitTitle("sw:", seen) }));
    try {
      const res = await scanWith(server, url("/sw.html"));
      expect(res.statusCode).toBe(200);
      expect(seen.title).not.toBe("sw:registrado");
      expect(hitsTo("/sw.js")).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe("conteúdo buscado no Node", () => {
  it.each([
    ["/gzip.html", "Página com gzip"],
    ["/br.html", "Página com brotli"],
  ])("%s é descompactado antes de chegar ao navegador", async (path, title) => {
    const res = await scan(url(path));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title, http_status: 200 });
  });

  it("recurso acima do limite falha e a varredura continua", async () => {
    // O script troca o título por "resultado,resultado,resultado" quando os três terminam.
    const seen: { title?: string } = {};
    const server = buildServer(
      browser,
      options({ analyze: waitTitle("", seen, (title) => title.includes(",")), limits: { maxResourceBytes: 64 * 1024 } }),
    );
    try {
      const res = await scanWith(server, url("/grande.html"));
      expect(res.statusCode).toBe(200);
      // 100 KB e uma bomba de gzip de 4 MB passam do limite de 64 KB; o arquivo pequeno chega.
      expect(seen.title).toBe("falhou,falhou,ok:3");
    } finally {
      await server.close();
    }
  });

  it("documento acima do limite devolve navigation_failed", async () => {
    const server = buildServer(browser, options({ limits: { maxResourceBytes: 64 * 1024 } }));
    try {
      const res = await scanWith(server, url("/documento-grande.html"));
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: "navigation_failed", detail: "recurso passou de 65536 bytes" });
    } finally {
      await server.close();
    }
  });
});

describe("DNS rebinding", () => {
  // O DNS de `rebind.exemplo.com` alterna entre 127.0.0.1, que só aqui conta como público,
  // e ::1, que continua proibido. Nenhuma imagem pode chegar pelo ::1.
  it("um DNS que alterna entre IP público e privado nunca leva a conexão no privado", async (ctx) => {
    if (!servers.ipv6) return ctx.skip();
    let calls = 0;
    const resolve: Resolve = async (host) => {
      if (host === "fixtures") return [{ address: "127.0.0.1", family: 4 }];
      calls += 1;
      return calls % 2 === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "::1", family: 6 }];
    };
    const server = buildServer(browser, {
      ssrf: fixturesPolicy(port, { resolve, isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) }),
    });
    try {
      const res = await scanWith(server, `http://rebind.exemplo.com:${port}/rebind.html`);
      expect(res.statusCode).toBe(200);
      expect(calls).toBeGreaterThanOrEqual(7);
      expect(res.json<ScanResult>().blocked_requests).toBeGreaterThanOrEqual(3);
      expect(servers.ipv6Hits).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe("o que escapa do route do Playwright", () => {
  it("WebSocket, SharedWorker, preconnect e WebRTC não chegam à rede", async () => {
    const before = servers.hits.length;
    const res = await scan(url("/fugas.html"));
    expect(res.statusCode).toBe(200);
    // Dá tempo para o ICE do WebRTC e para as conexões do navegador.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(servers.hits.slice(before).map((hit) => hit.url)).toEqual(["/fugas.html"]);
    expect(servers.upgrades()).toBe(0);
    expect(udpPackets).toBe(0);
  });

  it("o Chromium sem o route não acessa a rede sozinho", async () => {
    const before = servers.hits.length;
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await expect(page.goto(`http://127.0.0.1:${port}/limpa.html`)).rejects.toThrow(/ERR_PROXY_CONNECTION_FAILED/);
      const rtc = await context.newPage();
      await rtc.setContent(
        `<script>
          const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort()}" }] });
          pc.createDataChannel("x");
          pc.createOffer().then((offer) => pc.setLocalDescription(offer));
        </script>`,
      );
      await rtc.waitForTimeout(1_500);
      expect(servers.hits.length).toBe(before);
      expect(udpPackets).toBe(0);
    } finally {
      await context.close();
    }
  });
});
