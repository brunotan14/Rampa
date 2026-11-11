import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type AxeFacts, type ScanResponse } from "../src/contract.gen.js";
import { LAUNCH_OPTIONS, launchBrowser } from "../src/browser.js";
import { buildServer, type ServerOptions } from "../src/server.js";
import { scanOn } from "./support/contract.js";
import { isBlockedIp } from "../src/ssrf/ip.js";
import type { Resolve } from "../src/ssrf/policy.js";
import { fixturesPolicy, notFound } from "./support/policy.js";
import { startServers, type LocalServers } from "./support/servers.js";

// Bloqueio de requisições no scanner (RF-RA002), com o Chromium de verdade passando pelo
// proxy de saída da varredura. As páginas destes testes ficam aqui, e não em `fixtures/`,
// porque apontam para endereços proibidos.

const fixturesDir = new URL("./fixtures/", import.meta.url);
const limpa = readFileSync(new URL("limpa.html", fixturesDir));

const html = (title: string, body = "") =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

let servers: LocalServers;
let port: number;
let otherPort: number;
let other: Server;
const otherHits: string[] = [];
let udp: Socket;
let udpPackets = 0;
let browser: Browser;
let app: FastifyInstance;

type Page_ = { status?: number; headers?: Record<string, string | string[]>; body: string | Buffer; delayMs?: number };

const pages = (): Record<string, (cookie: string | undefined) => Page_> => ({
  "/limpa.html": () => ({ body: limpa }),
  "/redireciona-privado": () => ({ status: 302, headers: { location: "http://127.0.0.1/" }, body: "" }),
  "/redireciona-cadeia": () => ({ status: 301, headers: { location: "/redireciona-privado" }, body: "" }),
  "/redireciona-limpa": () => ({ status: 302, headers: { location: "/limpa.html" }, body: "" }),
  "/redireciona-porta": () => ({
    status: 302,
    headers: { location: `http://fixtures:${otherPort}/limpa.html` },
    body: "",
  }),
  "/laco": () => ({ status: 302, headers: { location: "/laco" }, body: "" }),
  "/onload-download.html": () => ({
    body: html("Navega para download", `<script>onload = () => { location.href = "/arquivo.zip"; };</script>`),
  }),
  "/arquivo.zip": () => ({
    headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="arquivo.zip"' },
    body: "PK",
  }),
  "/demorada.html": () => ({ body: limpa, delayMs: 800 }),
  "/onload-navega.html": () => ({
    body: html("Antes de navegar", `<script>onload = () => { location.href = "/redireciona-limpa"; };</script>`),
  }),
  "/onload-navega-privado.html": () => ({
    body: html(
      "Navega para nome privado",
      `<script>onload = () => { location.href = "http://interno.exemplo.com:${port}/"; };</script>`,
    ),
  }),
  "/navega-privado.html": () => ({
    body: html("Navega para IP privado", `<script>setTimeout(() => { location.href = "http://10.0.0.5/"; }, 50);</script>`),
  }),
  "/img-privada.html": () => ({ body: html("Imagem em IP privado", '<img src="http://192.168.0.1/x.png">') }),
  "/img-porta.html": () => ({
    body: html("Imagem em outra porta", '<img alt="" src="http://publico.exemplo.com:8080/x.png">'),
  }),
  "/img-redireciona-porta.html": () => ({
    body: html("Imagem que redireciona para outra porta", '<img alt="" src="/redireciona-img-porta">'),
  }),
  "/redireciona-img-porta": () => ({
    status: 302,
    headers: { location: `http://fixtures:${otherPort}/x.png` },
    body: "",
  }),
  "/img-redireciona-privada.html": () => ({
    body: html("Imagem que redireciona para IP privado", '<img alt="" src="/redireciona-img">'),
  }),
  "/redireciona-img": () => ({ status: 302, headers: { location: `http://127.0.0.1:${port}/segredo.png` }, body: "" }),
  "/iframe-privado.html": () => ({
    body: html("Iframe em IP privado", '<iframe title="Interno" src="http://10.0.0.5/"></iframe>'),
  }),
  "/fetch-privado.html": () => ({
    body: html(
      "Fetch para IP privado",
      `<script>
        const results = [];
        const done = (r) => { results.push(r); if (results.length === 2) document.title = "fetch:" + results.sort().join(","); };
        const check = (name) => (r) => done((r.ok ? "vazou-" : "bloqueado-") + name);
        fetch("http://127.0.0.1:${port}/segredo").then(check("ip"), () => done("bloqueado-ip"));
        fetch("http://interno.exemplo.com:${port}/segredo").then(check("nome"), () => done("bloqueado-nome"));
      </script>`,
    ),
  }),
  "/cookie-sub.html": () => ({
    body: html(
      "Cookie em redirecionamento de sub-recurso",
      `<script>fetch("/sub-redireciona").then((r) => r.text()).then((t) => { document.title = "sub:" + t; });</script>`,
    ),
  }),
  "/sub-redireciona": () => ({ status: 302, headers: { location: "/sub-destino", "set-cookie": "sc=1; Path=/" }, body: "" }),
  "/sub-destino": (cookie) => ({ body: cookie?.includes("sc=1") ? "com-cookie" : "sem-cookie" }),
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
  "/pesada.html": () => ({ body: html("Página pesada", '<img alt="" src="/grande.bin">') }),
  "/grande.bin": () => ({ headers: { "content-type": "application/octet-stream" }, body: Buffer.alloc(300 * 1024, 97) }),
  "/rebind.html": () => ({
    body: html(
      "Rebinding",
      Array.from({ length: 6 }, (_, i) => `<img alt="" src="http://rebind.exemplo.com:${port}/px.gif?${i}">`).join(""),
    ),
  }),
  "/px.gif": () => ({ headers: { "content-type": "image/gif" }, body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }),
  "/lento.gif": () => ({
    headers: { "content-type": "image/gif" },
    body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64"),
    delayMs: 300,
  }),
  "/muitas-imagens.html": () => ({
    body: html("Muitas imagens", Array.from({ length: 4 }, (_, i) => `<img alt="" src="/lento.gif?${i}">`).join("")),
  }),
  "/websocket.html": () => ({
    body: html(
      "WebSocket",
      `<script>
        const results = {};
        const done = () => {
          if (Object.keys(results).length === 3) document.title = "ws:" + results.publico + "," + results.privado + "," + results.porta;
        };
        const open = (name, url) => {
          const ws = new WebSocket(url);
          ws.onopen = () => { results[name] = "aberto"; done(); ws.close(); };
          ws.onerror = () => { results[name] = "falhou"; done(); };
        };
        open("publico", "ws://fixtures:${port}/ws-aceita");
        open("privado", "ws://127.0.0.1:${port}/ws-aceita-privado");
        open("porta", "ws://fixtures:${otherPort}/ws-aceita-porta");
      </script>`,
    ),
  }),
  "/shared-worker.html": () => ({
    body: html(
      "SharedWorker",
      `<script>
        const code = "fetch('http://fixtures:${port}/shared-publico'); fetch('http://interno.exemplo.com:${port}/shared-privado')";
        new SharedWorker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      </script>`,
    ),
  }),
  "/shared-publico": () => ({ body: "ok" }),
  "/preconnect.html": () => ({
    body: html(
      "Preconnect",
      `<link rel="preconnect" href="http://interno.exemplo.com:${port}/"><link rel="preconnect" href="https://10.0.0.5/">`,
    ),
  }),
  "/webrtc.html": () => ({
    body: html(
      "WebRTC",
      `<script>
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
    const { status = 200, headers = {}, body, delayMs = 0 } = page(req.headers.cookie);
    const send = () => res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers }).end(body);
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  });
  port = servers.port;

  // Servidor numa porta fora das permitidas: nada deve chegar a ele.
  other = createServer((req, res) => {
    otherHits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/html" }).end(limpa);
  });
  other.on("upgrade", (req, socket) => {
    otherHits.push(req.url ?? "");
    socket.destroy();
  });
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
  otherPort = (other.address() as AddressInfo).port;

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
  other.close();
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
  return scanOn(server, target);
}

const scan = (target: string) => scanWith(app, target);

async function withServer<T>(overrides: ServerOptions, run: (server: FastifyInstance) => Promise<T>): Promise<T> {
  const server = buildServer(browser, options(overrides));
  try {
    return await run(server);
  } finally {
    await server.close();
  }
}

// `analyze` que espera o script da página trocar o título e guarda o título.
function waitTitle(prefix: string, seen: { title?: string }) {
  return async (page: Page): Promise<AxeFacts> => {
    await page.waitForFunction((p) => document.title.startsWith(p), prefix, { timeout: 10_000 });
    seen.title = await page.title();
    return { version: "4.0.0", violations: [], incomplete: [] };
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("documento principal", () => {
  it("URL de endereço proibido é recusada sem abrir o navegador", async () => {
    const res = await scan("http://169.254.169.254/latest/meta-data/");
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "blocked_address", detail: "endereço proibido: 169.254.169.254" });
    expect(browser.contexts()).toHaveLength(0);
  });

  it("porta fora de 80/443 é recusada no documento", async () => {
    const res = await scanWith(buildServer(browser), "http://exemplo.com:8080/");
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "blocked_address", detail: "porta não permitida: 8080" });
  });

  it("URL com credenciais é recusada como invalid_url", async () => {
    const res = await scan(`http://usuario:senha@fixtures:${port}/limpa.html`);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "invalid_url", detail: "URL com credenciais" });
  });

  it("página que redireciona para http://127.0.0.1/ devolve blocked_address", async () => {
    const res = await scan(url("/redireciona-privado"));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "blocked_address", detail: "endereço proibido: 127.0.0.1" });
    expect(browser.contexts()).toHaveLength(0);
  });

  it("o bloqueio vale para qualquer salto da cadeia de redirecionamentos", async () => {
    const res = await scan(url("/redireciona-cadeia"));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "blocked_address", detail: "endereço proibido: 127.0.0.1" });
  });

  it("redirecionamento permitido é seguido e a página final é analisada", async () => {
    const res = await scan(url("/redireciona-limpa"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ final_url: url("/limpa.html"), http_status: 200, title: "Página limpa" });
  });

  it("redirecionamento do documento para porta não permitida devolve blocked_address", async () => {
    const res = await scan(url("/redireciona-porta"));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "blocked_address", detail: `porta não permitida: ${otherPort}` });
    // O proxy recusou o salto: o servidor da outra porta não recebeu nada.
    expect(otherHits).toEqual([]);
  });

  it("redirecionamento em laço devolve navigation_failed", async () => {
    const res = await scan(url("/laco"));
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("navigation_failed");
    expect(res.json().detail).toMatch(/ERR_TOO_MANY_REDIRECTS/);
  });

  it("navegação por script no onload que responde 302: analisa o destino real", async () => {
    const res = await scan(url("/onload-navega.html"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ final_url: url("/limpa.html"), http_status: 200, title: "Página limpa" });
  });

  it("navegação para download abortada não deixa a varredura esperando até o prazo", async () => {
    const started = Date.now();
    const res = await scan(url("/onload-download.html"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: "Navega para download" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("página que carrega no fim do prazo de abertura ainda é analisada", async () => {
    // Prazo de abertura de 1 s e documento que chega aos 0,8 s: a espera depois do `goto`
    // tem janela própria e não usa o que sobrou da abertura.
    await withServer({ navigationTimeoutMs: 1_000 }, async (server) => {
      const res = await scanWith(server, url("/demorada.html"));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ title: "Página limpa" });
    });
  });

  it("navegação do documento para IP proibido depois de aberto devolve blocked_address", async () => {
    const res = await scan(url("/navega-privado.html"));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "blocked_address", detail: "endereço proibido: 10.0.0.5" });
  });

  it("navegação para nome que resolve para IP proibido, vista só pelo proxy, devolve blocked_address", async () => {
    const res = await scan(url("/onload-navega-privado.html"));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      contract_version: CONTRACT_VERSION,
      error: "blocked_address",
      detail: "interno.exemplo.com resolve para endereço proibido: 127.0.0.1",
    });
  });
});

describe("sub-recursos", () => {
  it('a página com <img src="http://192.168.0.1/x.png"> termina, conta o bloqueio e traz os achados do axe', async () => {
    const res = await scan(url("/img-privada.html"));
    expect(res.statusCode).toBe(200);
    const body = res.json<ScanResponse>();
    expect(body.blocked_requests).toBe(1);
    expect(body.axe.violations.map((rule) => rule.id)).toContain("image-alt");
  });

  it("<img> em host público na porta 8080 é bloqueada e conta uma vez", async () => {
    const res = await scan(url("/img-porta.html"));
    expect(res.statusCode).toBe(200);
    expect(res.json<ScanResponse>().blocked_requests).toBe(1);
  });

  it("imagem que redireciona para porta não permitida: o proxy bloqueia o salto e conta", async () => {
    const res = await scan(url("/img-redireciona-porta.html"));
    expect(res.statusCode).toBe(200);
    expect(res.json<ScanResponse>().blocked_requests).toBe(1);
    expect(otherHits).toEqual([]);
  });

  it("imagem que redireciona para IP privado: o proxy bloqueia o salto e conta", async () => {
    const res = await scan(url("/img-redireciona-privada.html"));
    expect(res.statusCode).toBe(200);
    expect(res.json<ScanResponse>().blocked_requests).toBe(1);
    expect(hitsTo("/segredo.png")).toEqual([]);
  });

  it("iframe para IP privado é bloqueado e a varredura continua", async () => {
    const res = await scan(url("/iframe-privado.html"));
    expect(res.statusCode).toBe(200);
    expect(res.json<ScanResponse>().blocked_requests).toBe(1);
  });

  it("fetch por script para IP privado, literal ou resolvido, é bloqueado e contado uma vez", async () => {
    const seen: { title?: string } = {};
    await withServer({ analyze: waitTitle("fetch:", seen) }, async (server) => {
      const res = await scanWith(server, url("/fetch-privado.html"));
      expect(res.statusCode).toBe(200);
      expect(seen.title).toBe("fetch:bloqueado-ip,bloqueado-nome");
      // O IP literal o route recusa; o nome só o proxy vê. Cada um conta uma vez.
      expect(res.json<ScanResponse>().blocked_requests).toBe(2);
      // O servidor local é acessível: se a requisição tivesse escapado, ele a teria recebido.
      expect(hitsTo("/segredo")).toEqual([]);
    });
  });

  it("cookie definido num redirecionamento de sub-recurso chega ao destino", async () => {
    const seen: { title?: string } = {};
    await withServer({ analyze: waitTitle("sub:", seen) }, async (server) => {
      const res = await scanWith(server, url("/cookie-sub.html"));
      expect(res.statusCode).toBe(200);
      expect(seen.title).toBe("sub:com-cookie");
    });
  });

  it("service worker não é registrado", async () => {
    const seen: { title?: string } = {};
    await withServer({ analyze: waitTitle("sw:", seen) }, async (server) => {
      const res = await scanWith(server, url("/sw.html"));
      expect(res.statusCode).toBe(200);
      expect(seen.title).not.toBe("sw:registrado");
      expect(hitsTo("/sw.js")).toEqual([]);
    });
  });

  it("conteúdo comprimido é repassado cru e o navegador descompacta", async () => {
    const res = await scan(url("/gzip.html"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: "Página com gzip", http_status: 200 });
  });
});

describe("limites da varredura", () => {
  it("passar do teto de bytes devolve resource_limit", async () => {
    await withServer({ limits: { maxBytes: 128 * 1024 } }, async (server) => {
      const res = await scanWith(server, url("/pesada.html"));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "resource_limit", detail: `a página passou de ${128 * 1024} bytes trafegados` });
    });
  });

  it("passar do limite de conexões simultâneas devolve resource_limit", async () => {
    await withServer({ limits: { maxConnections: 2 } }, async (server) => {
      const res = await scanWith(server, url("/muitas-imagens.html"));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ contract_version: CONTRACT_VERSION, error: "resource_limit", detail: "a página abriu mais de 2 conexões simultâneas" });
    });
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
      expect(res.json<ScanResponse>().blocked_requests).toBeGreaterThanOrEqual(3);
      expect(servers.ipv6Hits).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe("o que o route do Playwright não vê passa pelo proxy", () => {
  it("WebSocket público funciona; para IP privado ou porta fora de 80/443 é bloqueado", async () => {
    const seen: { title?: string } = {};
    await withServer({ analyze: waitTitle("ws:", seen) }, async (server) => {
      const res = await scanWith(server, url("/websocket.html"));
      expect(res.statusCode).toBe(200);
      expect(seen.title).toBe("ws:aberto,falhou,falhou");
      expect(servers.upgrades).toContain("/ws-aceita");
      expect(servers.upgrades).not.toContain("/ws-aceita-privado");
      expect(otherHits).toEqual([]);
      expect(res.json<ScanResponse>().blocked_requests).toBe(2);
    });
  });

  it("SharedWorker passa pelo proxy validado", async () => {
    await withServer(
      {
        analyze: async (page) => {
          await page.waitForTimeout(1_000);
          return { version: "4.0.0", violations: [], incomplete: [] };
        },
      },
      async (server) => {
        const res = await scanWith(server, url("/shared-worker.html"));
        expect(res.statusCode).toBe(200);
        expect(hitsTo("/shared-publico")).not.toEqual([]);
        expect(hitsTo("/shared-privado")).toEqual([]);
        expect(res.json<ScanResponse>().blocked_requests).toBe(1);
      },
    );
  });

  it("preconnect para destino proibido não chega ao destino", async () => {
    const before = servers.hits.length;
    const res = await scan(url("/preconnect.html"));
    expect(res.statusCode).toBe(200);
    await sleep(500);
    expect(servers.hits.slice(before).map((hit) => hit.url)).toEqual(["/preconnect.html"]);
  });

  it("WebRTC não sai por UDP", async () => {
    const before = udpPackets;
    const res = await scan(url("/webrtc.html"));
    expect(res.statusCode).toBe(200);
    await sleep(1_500);
    expect(udpPackets).toBe(before);
  });

  it("contexto sem o proxy da varredura não acessa a rede", async () => {
    const before = servers.hits.length;
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await expect(page.goto(`http://127.0.0.1:${port}/limpa.html`)).rejects.toThrow(/ERR_PROXY_CONNECTION_FAILED/);
      expect(servers.hits.length).toBe(before);
    } finally {
      await context.close();
    }
  });

  // Controle: prova que o teste acima e o de WebRTC detectam uma fuga. Sem a política de
  // WebRTC do lançamento, o STUN sai por UDP direto, mesmo com o proxy no contexto.
  it("controle: sem --force-webrtc-ip-handling-policy, o WebRTC escapa do proxy", async () => {
    const plain = await chromium.launch({
      ...LAUNCH_OPTIONS,
      args: (LAUNCH_OPTIONS.args ?? []).filter((arg) => !arg.startsWith("--force-webrtc-ip-handling-policy")),
    });
    const server = buildServer(plain, options());
    try {
      const before = udpPackets;
      const res = await scanWith(server, url("/webrtc.html"));
      expect(res.statusCode).toBe(200);
      for (let i = 0; i < 30 && udpPackets === before; i++) await sleep(100);
      expect(udpPackets).toBeGreaterThan(before);
    } finally {
      await server.close();
      await plain.close();
    }
  });
});
