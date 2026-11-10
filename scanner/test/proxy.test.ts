import http, { type IncomingHttpHeaders } from "node:http";
import type { Socket } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isBlockedIp } from "../src/ssrf/ip.js";
import { defaultPolicy, type Resolve, type SsrfPolicy } from "../src/ssrf/policy.js";
import { BLOCKED_HEADER, DEFAULT_PROXY_LIMITS, startScanProxy, type ProxyLimits, type ScanProxy } from "../src/ssrf/proxy.js";
import { notFound } from "./support/policy.js";
import { startServers, type LocalServers } from "./support/servers.js";

// O proxy de saída da varredura, sem o Chromium: um cliente HTTP fala com ele como o
// navegador fala (requisição absoluta para http://, CONNECT para o resto).

const PAGE = "<!doctype html><title>Comprimida</title><p>ação</p>";

let servers: LocalServers;
let proxy: ScanProxy | undefined;

beforeAll(async () => {
  servers = await startServers((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/gzip") return res.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync(PAGE));
    if (path === "/grande") return res.writeHead(200).end(Buffer.alloc(200 * 1024, 97));
    if (path === "/lento") return setTimeout(() => res.writeHead(200).end("ok"), 300);
    if (path === "/eco") {
      return res.writeHead(200, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] }).end(
        JSON.stringify(req.headers),
      );
    }
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  });
});

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
});

afterAll(() => servers.close());

const resolveTest: Resolve = async (host) => {
  if (host === "fixtures" || host === "interno.exemplo.com") return [{ address: "127.0.0.1", family: 4 }];
  throw notFound(host);
};

async function start(overrides: Partial<SsrfPolicy> = {}, limits: Partial<ProxyLimits> = {}) {
  proxy = await startScanProxy(
    // A porta do servidor local entra na política de teste; nenhuma outra (ver `support/policy.ts`).
    defaultPolicy({
      allowlist: new Set(["fixtures"]),
      ports: new Set([80, 443, servers.port]),
      resolve: resolveTest,
      ...overrides,
    }),
    { ...DEFAULT_PROXY_LIMITS, ...limits },
  );
  return proxy;
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

// Requisição absoluta, como o navegador faz para http:// através de um proxy.
function viaProxy(target: string, headers: Record<string, string> = {}): Promise<Answer> {
  const { port } = new URL(proxy!.url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: target, headers: { host: new URL(target).host, ...headers }, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// CONNECT, como o navegador faz para https:// e WebSocket.
function tunnel(authority: string): Promise<{ status: number; socket: Socket }> {
  const { port } = new URL(proxy!.url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: authority, agent: false });
    req.on("connect", (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
    req.on("error", reject);
    req.end();
  });
}

const hitsTo = (path: string) => servers.hits.filter((hit) => hit.url.startsWith(path));

describe("requisição absoluta (http://)", () => {
  it("repassa em fluxo, sem descompactar", async () => {
    await start();
    const res = await viaProxy(`http://fixtures:${servers.port}/gzip`);
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.body.equals(gzipSync(PAGE))).toBe(true);
  });

  it("tira os cabeçalhos hop-by-hop e os listados em Connection, e mantém os repetidos", async () => {
    await start();
    const res = await viaProxy(`http://fixtures:${servers.port}/eco`, {
      connection: "keep-alive, x-so-nesta-conexao",
      "x-so-nesta-conexao": "1",
      "proxy-authorization": "Basic segredo",
      cookie: "sessao=1",
    });
    const echoed = JSON.parse(res.body.toString()) as IncomingHttpHeaders;
    expect(echoed["x-so-nesta-conexao"]).toBeUndefined();
    expect(echoed["proxy-authorization"]).toBeUndefined();
    expect(echoed.cookie).toBe("sessao=1");
    expect(echoed.host).toBe(`fixtures:${servers.port}`);
    expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
  });

  it("IP proibido: responde 403 com o token da varredura e não conecta", async () => {
    await start();
    const before = servers.hits.length;
    const res = await viaProxy(`http://127.0.0.1:${servers.port}/segredo?token=abc`);
    expect(res.status).toBe(403);
    expect(res.headers[BLOCKED_HEADER]).toBe(proxy!.token);
    expect(servers.hits.length).toBe(before);
    // Host e motivo, sem caminho nem consulta da página.
    expect(proxy!.blocks).toEqual([{ target: `127.0.0.1:${servers.port}`, detail: "endereço proibido: 127.0.0.1" }]);
  });

  it("nome que resolve para IP proibido: bloqueado antes de conectar", async () => {
    await start();
    const before = servers.hits.length;
    const res = await viaProxy(`http://interno.exemplo.com:${servers.port}/segredo`);
    expect(res.status).toBe(403);
    expect(servers.hits.length).toBe(before);
    expect(proxy!.blocks[0]?.detail).toBe("interno.exemplo.com resolve para endereço proibido: 127.0.0.1");
  });

  it("basta um IP proibido entre os resolvidos", async () => {
    await start({
      resolve: async () => [
        { address: "93.184.215.14", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    const res = await viaProxy(`http://misto.exemplo.com:${servers.port}/`);
    expect(res.status).toBe(403);
    expect(proxy!.blocks[0]?.detail).toBe("misto.exemplo.com resolve para endereço proibido: 10.0.0.5");
  });

  it("porta fora de 80/443 é recusada, mesmo em host liberado e público", async () => {
    let calls = 0;
    await start({ resolve: async () => (calls++, [{ address: "93.184.215.14", family: 4 }]) });
    const liberado = await viaProxy("http://fixtures:8080/imagem.png");
    const publico = await viaProxy("http://cdn.exemplo.com:8080/imagem.png");
    expect([liberado.status, publico.status]).toEqual([403, 403]);
    expect(calls).toBe(0);
    expect(proxy!.blocks).toEqual([
      { target: "fixtures:8080", detail: "porta não permitida: 8080" },
      { target: "cdn.exemplo.com:8080", detail: "porta não permitida: 8080" },
    ]);
  });

  it("nome interno é recusado sem consultar o DNS", async () => {
    let calls = 0;
    await start({ resolve: async () => (calls++, [{ address: "93.184.215.14", family: 4 }]) });
    const res = await viaProxy("http://postgres/");
    expect(res.status).toBe(403);
    expect(calls).toBe(0);
    expect(proxy!.blocks[0]?.detail).toBe("nome interno: postgres");
  });

  it("DNS que não resolve: corta a conexão e guarda o erro do destino", async () => {
    await start();
    await expect(viaProxy(`http://nao-resolve.exemplo.com:${servers.port}/`)).rejects.toThrow();
    expect(proxy!.blocks).toEqual([]);
    expect(proxy!.errors.get(`nao-resolve.exemplo.com:${servers.port}`)).toBe(
      "getaddrinfo ENOTFOUND nao-resolve.exemplo.com",
    );
  });
});

describe("CONNECT", () => {
  it("destino permitido: o túnel liga direto no servidor", async () => {
    await start();
    const { status, socket } = await tunnel(`fixtures:${servers.port}`);
    expect(status).toBe(200);
    const answer = await new Promise<string>((resolve) => {
      let data = "";
      socket.on("data", (chunk: Buffer) => (data += chunk.toString()));
      socket.on("end", () => resolve(data));
      socket.write(`GET /pelo-tunel HTTP/1.1\r\nHost: fixtures\r\nConnection: close\r\n\r\n`);
    });
    expect(answer).toMatch(/^HTTP\/1\.1 200/);
    expect(hitsTo("/pelo-tunel")).toHaveLength(1);
  });

  it.each([
    ["127.0.0.1:443", "endereço proibido: 127.0.0.1"],
    ["[::1]:443", "endereço proibido: ::1"],
    ["169.254.169.254:80", "endereço proibido: 169.254.169.254"],
    ["localhost:443", "nome interno: localhost"],
    ["interno.exemplo.com:443", "interno.exemplo.com resolve para endereço proibido: 127.0.0.1"],
    ["cdn.exemplo.com:8443", "porta não permitida: 8443"],
    ["fixtures:22", "porta não permitida: 22"],
    ["[2606:4700:4700::1111]:8080", "porta não permitida: 8080"],
  ])("%s é recusado com 403", async (authority, detail) => {
    await start();
    const { status, socket } = await tunnel(authority);
    socket.destroy();
    expect(status).toBe(403);
    expect(proxy!.blocks.map((block) => block.detail)).toEqual([detail]);
  });
});

describe("limites", () => {
  it("passar do teto de bytes corta as conexões e registra o motivo", async () => {
    await start({}, { maxBytes: 64 * 1024 });
    await expect(viaProxy(`http://fixtures:${servers.port}/grande`)).rejects.toThrow();
    expect(proxy!.limitExceeded).toBe(`a página passou de ${64 * 1024} bytes trafegados`);
    // Depois de estourar, nada mais passa.
    await expect(viaProxy(`http://fixtures:${servers.port}/`)).rejects.toThrow();
  });

  it("passar do limite de conexões simultâneas corta as conexões e registra o motivo", async () => {
    await start({}, { maxConnections: 2 });
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => viaProxy(`http://fixtures:${servers.port}/lento`)),
    );
    expect(results.some((result) => result.status === "rejected")).toBe(true);
    expect(proxy!.limitExceeded).toBe("a página abriu mais de 2 conexões simultâneas");
  });

  it("os valores padrão são 100 MB e 64 conexões", () => {
    expect(DEFAULT_PROXY_LIMITS).toMatchObject({ maxBytes: 100 * 1024 * 1024, maxConnections: 64 });
  });
});

describe("DNS rebinding", () => {
  // O DNS alterna entre um IP "público" (127.0.0.1, só neste teste) e um privado (::1).
  // Cada conexão usa o IP que acabou de ser validado, então nenhuma chega ao ::1.
  it("DNS que alterna entre público e privado nunca leva a conexão no privado", async (ctx) => {
    if (!servers.ipv6) return ctx.skip();
    let calls = 0;
    await start({
      resolve: async () => {
        calls += 1;
        return calls % 2 === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "::1", family: 6 }];
      },
      isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip),
    });

    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, i) => viaProxy(`http://rebind.exemplo.com:${servers.port}/px?${i}`)),
    );

    expect(calls).toBe(8);
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(4);
    expect(answers.filter((answer) => answer.status === 403)).toHaveLength(4);
    expect(proxy!.blocks).toHaveLength(4);
    expect(servers.ipv6Hits).toEqual([]);
  });
});
