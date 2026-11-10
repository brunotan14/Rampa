import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlockedError, DEFAULT_LIMITS, fetchResource, TooLargeError, type FetchOptions } from "../src/ssrf/fetch.js";
import { isBlockedIp } from "../src/ssrf/ip.js";
import { defaultPolicy, type Resolve, type SsrfPolicy } from "../src/ssrf/policy.js";
import { notFound } from "./support/policy.js";
import { startServers, type LocalServers } from "./support/servers.js";

const PAGE = "<!doctype html><title>Comprimida</title><p>ação</p>";

let servers: LocalServers;
let base: string;

beforeAll(async () => {
  servers = await startServers((req, res, body) => {
    const url = new URL(req.url ?? "/", "http://x");
    switch (url.pathname) {
      case "/gzip":
        return res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(gzipSync(PAGE));
      case "/br":
        return res.writeHead(200, { "content-type": "text/html", "content-encoding": "br" }).end(brotliCompressSync(PAGE));
      case "/deflate":
        return res.writeHead(200, { "content-encoding": "deflate" }).end(deflateSync(PAGE));
      case "/deflate-cru":
        return res.writeHead(200, { "content-encoding": "deflate" }).end(deflateRawSync(PAGE));
      case "/dupla":
        return res.writeHead(200, { "content-encoding": "gzip, br" }).end(brotliCompressSync(gzipSync(PAGE)));
      case "/desconhecida":
        return res.writeHead(200, { "content-encoding": "compress" }).end("x");
      case "/cookies":
        res.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/; HttpOnly"]);
        return res.writeHead(200).end("ok");
      case "/eco":
        return res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ method: req.method, body, headers: req.headers }),
        );
      case "/grande":
        return res.writeHead(200).end(Buffer.alloc(2048, 1));
      case "/bomba":
        return res.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync(Buffer.alloc(1024 * 1024)));
      case "/redireciona":
        return res.writeHead(302, { location: url.searchParams.get("para") ?? "/eco" }).end();
      case "/redireciona-303":
        return res.writeHead(303, { location: "/eco" }).end();
      case "/redireciona-307":
        return res.writeHead(307, { location: "/eco" }).end();
      case "/laco":
        return res.writeHead(302, { location: "/laco" }).end();
      default:
        return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    }
  });
  base = `http://fixtures:${servers.port}`;
});

afterAll(() => servers.close());

const fixturesOnly: Resolve = async (host) => {
  if (host === "fixtures" || host === "outro.fixtures.test") return [{ address: "127.0.0.1", family: 4 }];
  throw notFound(host);
};

const policy = (overrides: Partial<SsrfPolicy> = {}) =>
  defaultPolicy({ allowlist: new Set(["fixtures"]), resolve: fixturesOnly, ...overrides });

const options = (overrides: Partial<FetchOptions> = {}): FetchOptions => ({
  kind: "subresource",
  followRedirects: true,
  limits: DEFAULT_LIMITS,
  signal: new AbortController().signal,
  ...overrides,
});

const get = (url: string, headers: Record<string, string> = {}) => ({ url, method: "GET", headers, body: null });

describe("content-encoding", () => {
  it.each(["/gzip", "/br", "/deflate", "/deflate-cru", "/dupla"])("%s chega descompactado e sem o cabeçalho", async (path) => {
    const res = await fetchResource(get(`${base}${path}`), policy(), options());
    expect(res.body.toString("utf8")).toBe(PAGE);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers["content-length"]).toBeUndefined();
  });

  it("pede só os formatos que sabe descompactar", async () => {
    const res = await fetchResource(get(`${base}/eco`, { "accept-encoding": "gzip, deflate, br, zstd" }), policy(), options());
    expect(JSON.parse(res.body.toString()).headers["accept-encoding"]).toBe("gzip, deflate, br");
  });

  it("recusa codificação que não conhece", async () => {
    await expect(fetchResource(get(`${base}/desconhecida`), policy(), options())).rejects.toThrow(
      "codificação não suportada: compress",
    );
  });
});

describe("limite de tamanho", () => {
  const limits = { ...DEFAULT_LIMITS, maxResourceBytes: 1024 };

  it("recusa recurso acima do limite", async () => {
    await expect(fetchResource(get(`${base}/grande`), policy(), options({ limits }))).rejects.toBeInstanceOf(TooLargeError);
  });

  it("recusa recurso pequeno que descompacta acima do limite", async () => {
    await expect(fetchResource(get(`${base}/bomba`), policy(), options({ limits }))).rejects.toBeInstanceOf(TooLargeError);
  });

  it("o limite padrão é 10 MB", () => {
    expect(DEFAULT_LIMITS.maxResourceBytes).toBe(10 * 1024 * 1024);
  });
});

describe("pedido e resposta", () => {
  it("repassa método, corpo e cookie, e remove os cabeçalhos da conexão", async () => {
    const res = await fetchResource(
      {
        url: `${base}/eco`,
        method: "POST",
        headers: { cookie: "sessao=1", "content-type": "text/plain", connection: "keep-alive", host: "outro", ":method": "POST" },
        body: Buffer.from("olá"),
      },
      policy(),
      options(),
    );
    const echo = JSON.parse(res.body.toString());
    expect(echo.method).toBe("POST");
    expect(echo.body).toBe("olá");
    expect(echo.headers.cookie).toBe("sessao=1");
    expect(echo.headers.host).toBe(`fixtures:${servers.port}`);
    expect(echo.headers.connection).toBe("close");
  });

  it("junta vários Set-Cookie com quebra de linha, como o route.fulfill espera", async () => {
    const res = await fetchResource(get(`${base}/cookies`), policy(), options());
    expect(res.headers["set-cookie"]).toBe("a=1; Path=/\nb=2; Path=/; HttpOnly");
  });
});

describe("redirecionamento", () => {
  it("sub-recurso: o Node segue o redirecionamento", async () => {
    const res = await fetchResource(get(`${base}/redireciona`), policy(), options());
    expect(res.status).toBe(200);
    expect(res.url).toBe(`${base}/eco`);
  });

  it("documento: devolve o 3xx sem seguir", async () => {
    const res = await fetchResource(get(`${base}/redireciona`), policy(), options({ followRedirects: false }));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/eco");
  });

  it("cada salto passa pela checagem: redirecionar para IP proibido é bloqueado", async () => {
    const before = servers.hits.length;
    const target = encodeURIComponent(`http://127.0.0.1:${servers.port}/segredo`);
    await expect(fetchResource(get(`${base}/redireciona?para=${target}`), policy(), options())).rejects.toBeInstanceOf(
      BlockedError,
    );
    expect(servers.hits.slice(before).map((hit) => hit.url)).toEqual([`/redireciona?para=${target}`]);
  });

  it("303 vira GET sem corpo; 307 mantém o método e o corpo", async () => {
    const post = (path: string) => ({ url: `${base}${path}`, method: "POST", headers: {}, body: Buffer.from("dados") });

    const see = JSON.parse((await fetchResource(post("/redireciona-303"), policy(), options())).body.toString());
    expect(see).toMatchObject({ method: "GET", body: "" });

    const temp = JSON.parse((await fetchResource(post("/redireciona-307"), policy(), options())).body.toString());
    expect(temp).toMatchObject({ method: "POST", body: "dados" });
  });

  it("não leva o cookie para outra origem", async () => {
    const target = encodeURIComponent(`http://outro.fixtures.test:${servers.port}/eco`);
    const res = await fetchResource(get(`${base}/redireciona?para=${target}`, { cookie: "sessao=1" }), policy({
      // Só neste teste o 127.0.0.1 conta como público, para o outro nome ser acessível.
      isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip),
    }), options());
    expect(JSON.parse(res.body.toString()).headers.cookie).toBeUndefined();
  });

  it("para depois de 10 redirecionamentos", async () => {
    await expect(fetchResource(get(`${base}/laco`), policy(), options())).rejects.toThrow("mais de 10 redirecionamentos");
  });
});

describe("DNS validado na conexão", () => {
  it("nome que resolve para IP proibido nunca conecta", async () => {
    const before = servers.hits.length;
    const resolve: Resolve = async () => [{ address: "127.0.0.1", family: 4 }];
    await expect(
      fetchResource(get(`http://interno.exemplo.com:${servers.port}/segredo`), policy({ resolve }), options()),
    ).rejects.toBeInstanceOf(BlockedError);
    expect(servers.hits.length).toBe(before);
  });

  it("basta um IP proibido entre os resolvidos", async () => {
    const resolve: Resolve = async () => [
      { address: "93.184.215.14", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    await expect(
      fetchResource(get(`http://misto.exemplo.com:${servers.port}/`), policy({ resolve }), options()),
    ).rejects.toThrow("misto.exemplo.com resolve para endereço proibido: 10.0.0.5");
  });

  // Rebinding: o DNS alterna entre um IP "público" (127.0.0.1, só neste teste) e um
  // privado (::1). Cada conexão usa o IP que acabou de ser validado, então nenhuma chega
  // ao ::1, nem quando o nome foi aceito na consulta anterior.
  it("DNS que alterna entre público e privado nunca leva a conexão no privado", async (ctx) => {
    if (!servers.ipv6) return ctx.skip();
    let calls = 0;
    const resolve: Resolve = async () => {
      calls += 1;
      return calls % 2 === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "::1", family: 6 }];
    };
    const rebinding = policy({ resolve, isBlockedIp: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        fetchResource(get(`http://rebind.exemplo.com:${servers.port}/px?${i}`), rebinding, options()),
      ),
    );

    expect(calls).toBe(8);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof BlockedError)).toHaveLength(4);
    expect(servers.ipv6Hits).toEqual([]);
  });
});
