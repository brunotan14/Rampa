import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { checkUrl, normalizeHost, type ResolvedAddress, type SsrfPolicy } from "./policy.js";

// Proxy de saída de uma varredura (RF-RA002). O contexto do Chromium usa este proxy para
// tudo o que vai à rede: documento, sub-recursos, saltos de redirecionamento, WebSocket,
// workers. Para cada conexão o proxy confere esquema, nome e IP (`checkUrl`), resolve o nome,
// recusa se **qualquer** IP for proibido e conecta no IP validado. Não há janela entre checar
// e conectar: um DNS que alterna entre IP público e privado (rebinding) nunca leva a uma
// conexão no privado.
//
//   * CONNECT host:porta (HTTPS, WSS e WS): túnel ligado direto, sem ler o conteúdo;
//   * requisição absoluta HTTP: repassada em fluxo, sem descompactar, sem os cabeçalhos
//     hop-by-hop;
//   * upgrade de WebSocket em requisição absoluta: repassado em fluxo.
//
// Um proxy por varredura separa a contagem de bloqueios e o teto de dados de cada página.

export interface ProxyLimits {
  // Teto de bytes trafegados na varredura, nos dois sentidos, somando túneis e repasses.
  maxBytes: number;
  // Conexões simultâneas com o destino.
  maxConnections: number;
  // Tempo para abrir a conexão com o destino.
  connectTimeoutMs: number;
}

export const DEFAULT_PROXY_LIMITS: ProxyLimits = {
  maxBytes: 100 * 1024 * 1024,
  maxConnections: 64,
  connectTimeoutMs: 10_000,
};

export interface ProxyBlock {
  // `host:porta` normalizado, para casar com as requisições do documento principal.
  target: string;
  // Host e motivo, sem caminho nem conteúdo da página.
  detail: string;
}

// Cabeçalho da resposta com que o proxy recusa uma requisição HTTP. O valor é um token da
// varredura, que a página não conhece: assim a resposta de bloqueio do documento não se
// confunde com uma resposta 403 do site.
export const BLOCKED_HEADER = "x-rampa-blocked";

export interface ScanProxy {
  url: string;
  token: string;
  // Conexões e requisições recusadas pela proteção, na ordem em que aconteceram.
  readonly blocks: readonly ProxyBlock[];
  // Último erro (não de bloqueio) por destino, para explicar uma navegação que falhou.
  readonly errors: ReadonlyMap<string, string>;
  // Motivo, se a varredura passou de um dos limites; as conexões já foram cortadas.
  readonly limitExceeded: string | null;
  bytes(): number;
  close(): Promise<void>;
}

class BlockedError extends Error {}

// Cabeçalhos que dizem respeito a uma conexão só, não ao recurso (RFC 9110, 7.6.1).
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DEFAULT_PORTS: Record<string, number> = { "http:": 80, "https:": 443, "ws:": 80, "wss:": 443 };

export function targetKey(host: string, port: number): string {
  return `${normalizeHost(host)}:${port}`;
}

// `host:porta` de uma URL, com a porta padrão do esquema.
export function urlTargetKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const port = parsed.port === "" ? DEFAULT_PORTS[parsed.protocol] : Number(parsed.port);
    return port === undefined ? null : targetKey(parsed.hostname, port);
  } catch {
    return null;
  }
}

// Remove os hop-by-hop e os que o próprio `Connection` lista; mantém repetidos e a ordem.
function forwardHeaders(raw: string[], keepUpgrade = false): string[] {
  const listed = new Set<string>();
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]!.toLowerCase() === "connection") {
      for (const token of raw[i + 1]!.split(",")) listed.add(token.trim().toLowerCase());
    }
  }
  const result: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!.toLowerCase();
    const upgradeHeader = keepUpgrade && (name === "upgrade" || name === "connection");
    if (!upgradeHeader && (HOP_BY_HOP.has(name) || listed.has(name))) continue;
    result.push(raw[i]!, raw[i + 1]!);
  }
  return result;
}

// `host:porta` de um CONNECT; IPv6 vem entre colchetes.
function parseAuthority(authority: string): { host: string; port: number } | null {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(authority);
  if (!match) return null;
  const port = Number(match[2]);
  return port > 0 && port < 65536 ? { host: match[1]!, port } : null;
}

export async function startScanProxy(policy: SsrfPolicy, limits: ProxyLimits = DEFAULT_PROXY_LIMITS): Promise<ScanProxy> {
  const token = randomUUID();
  const blocks: ProxyBlock[] = [];
  const errors = new Map<string, string>();
  const sockets = new Set<Duplex>();
  let upstreams = 0;
  let bytes = 0;
  let limitExceeded: string | null = null;

  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };

  const exceed = (reason: string) => {
    if (limitExceeded !== null) return;
    limitExceeded = reason;
    for (const socket of sockets) socket.destroy();
  };

  const count = (size: number) => {
    bytes += size;
    if (bytes > limits.maxBytes) exceed(`a página passou de ${limits.maxBytes} bytes trafegados`);
  };

  // Liga dois fluxos contando os bytes nos dois sentidos.
  const join = (a: Duplex, b: Duplex) => {
    a.on("data", (chunk: Buffer) => count(chunk.length));
    b.on("data", (chunk: Buffer) => count(chunk.length));
    a.pipe(b);
    b.pipe(a);
    const close = () => {
      a.destroy();
      b.destroy();
    };
    a.once("close", close);
    b.once("close", close);
    a.on("error", close);
    b.on("error", close);
  };

  // Confere o destino e devolve os IPs validados, na ordem do DNS.
  async function resolveTarget(scheme: string, host: string, port: number): Promise<ResolvedAddress[]> {
    const check = checkUrl(`${scheme}//${host}:${port}/`, policy, "subresource");
    if (!check.ok) throw new BlockedError(check.detail);
    if (check.ip !== null) return [{ address: check.ip, family: check.ip.includes(":") ? 6 : 4 }];

    const addresses = await policy.resolve(check.host);
    if (!check.allowlisted) {
      const blocked = addresses.find(({ address }) => policy.isBlockedIp(address));
      if (blocked) throw new BlockedError(`${check.host} resolve para endereço proibido: ${blocked.address}`);
    }
    if (addresses.length === 0) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${check.host}`), { code: "ENOTFOUND" });
    }
    return addresses;
  }

  // Abre a conexão com o primeiro IP validado que aceitar, dentro dos limites.
  async function connect(scheme: string, host: string, port: number): Promise<Socket> {
    if (limitExceeded !== null) throw new Error(limitExceeded);
    const addresses = await resolveTarget(scheme, host, port);
    if (upstreams >= limits.maxConnections) {
      exceed(`a página abriu mais de ${limits.maxConnections} conexões simultâneas`);
      throw new Error(limitExceeded ?? "limite de conexões");
    }

    let lastError: Error = new Error("sem endereço");
    for (const { address, family } of addresses) {
      try {
        const socket = await new Promise<Socket>((resolve, reject) => {
          const attempt = net.connect({ host: address, port, family, timeout: limits.connectTimeoutMs });
          attempt.once("connect", () => {
            attempt.setTimeout(0);
            resolve(attempt);
          });
          attempt.once("timeout", () => attempt.destroy(new Error(`tempo esgotado ao conectar em ${host}:${port}`)));
          attempt.once("error", reject);
        });
        upstreams += 1;
        socket.once("close", () => (upstreams -= 1));
        track(socket);
        return socket;
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw lastError;
  }

  // Bloqueio registrado uma vez por conexão ou requisição recusada.
  const refuse = (target: string, error: unknown): boolean => {
    if (error instanceof BlockedError) {
      blocks.push({ target, detail: error.message });
      return true;
    }
    errors.set(target, error instanceof Error ? error.message : String(error));
    return false;
  };

  const server = http.createServer();
  server.keepAliveTimeout = 5_000;

  server.on("connection", track);

  server.on("connect", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    const authority = parseAuthority(req.url ?? "");
    if (!authority) {
      client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const target = targetKey(authority.host, authority.port);
    client.on("error", () => client.destroy());
    connect("https:", authority.host, authority.port).then(
      (upstream) => {
        if (client.destroyed) return upstream.destroy();
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) {
          count(head.length);
          upstream.write(head);
        }
        join(client, upstream);
      },
      (error: unknown) => {
        const status = refuse(target, error) ? "403 Forbidden" : "502 Bad Gateway";
        client.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      },
    );
  });

  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "");
      if (url.protocol !== "http:") throw new Error("esquema");
    } catch {
      res.writeHead(400, { connection: "close" }).end();
      return;
    }
    const port = url.port === "" ? 80 : Number(url.port);
    const target = targetKey(url.hostname, port);

    connect("http:", url.hostname, port).then(
      (socket) => {
        const upstream = http.request({
          createConnection: () => socket,
          method: req.method,
          path: `${url.pathname}${url.search}`,
          headers: forwardHeaders(req.rawHeaders),
          setHost: false,
        });
        upstream.on("response", (response) => {
          response.on("data", (chunk: Buffer) => count(chunk.length));
          res.writeHead(response.statusCode ?? 502, response.statusMessage, forwardHeaders(response.rawHeaders));
          response.pipe(res);
        });
        upstream.on("error", () => res.destroy());
        res.on("close", () => socket.destroy());
        req.on("data", (chunk: Buffer) => count(chunk.length));
        req.pipe(upstream);
      },
      (error: unknown) => {
        if (refuse(target, error)) {
          // Resposta, e não conexão cortada: o Chromium não repete o pedido, e o bloqueio
          // conta uma vez só.
          res.writeHead(403, {
            "content-type": "text/plain; charset=utf-8",
            connection: "close",
            [BLOCKED_HEADER]: token,
          });
          res.end("Bloqueado pela proteção contra SSRF do Rampa.");
        } else {
          res.destroy();
        }
      },
    );
  });

  // WebSocket em texto puro pedido como requisição absoluta (o Chromium costuma usar CONNECT).
  server.on("upgrade", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "");
      if (url.protocol !== "http:" && url.protocol !== "ws:") throw new Error("esquema");
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const port = url.port === "" ? 80 : Number(url.port);
    const target = targetKey(url.hostname, port);
    client.on("error", () => client.destroy());
    connect("http:", url.hostname, port).then(
      (upstream) => {
        const headers = forwardHeaders(req.rawHeaders, true);
        let request = `${req.method} ${url.pathname}${url.search} HTTP/1.1\r\n`;
        for (let i = 0; i < headers.length; i += 2) request += `${headers[i]}: ${headers[i + 1]}\r\n`;
        upstream.write(`${request}\r\n`);
        if (head.length > 0) upstream.write(head);
        join(client, upstream);
      },
      (error: unknown) => {
        const status = refuse(target, error) ? "403 Forbidden" : "502 Bad Gateway";
        client.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      },
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    blocks,
    errors,
    get limitExceeded() {
      return limitExceeded;
    },
    bytes: () => bytes,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
