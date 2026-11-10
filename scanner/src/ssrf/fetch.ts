import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { checkUrl, type RequestKind, type SsrfPolicy } from "./policy.js";

// Busca de um recurso da página no Node, em vez de deixar o Chromium acessar a rede
// (RF-RA002). O `lookup` próprio resolve o nome, recusa se **qualquer** IP for proibido e
// entrega à conexão só os IPs validados: não há janela entre checar e conectar, e um DNS
// que alterna entre IP público e privado (rebinding) nunca leva a uma conexão no privado.
// O hostname continua no pedido, para SNI, certificado e cabeçalho Host.

export interface FetchLimits {
  // Tamanho máximo de um recurso, depois de descompactado (RNF-RA003).
  maxResourceBytes: number;
  // Redirecionamentos seguidos no Node para um sub-recurso.
  maxRedirects: number;
  // Tempo máximo sem dados na conexão.
  idleTimeoutMs: number;
}

export const DEFAULT_LIMITS: FetchLimits = {
  maxResourceBytes: 10 * 1024 * 1024,
  maxRedirects: 10,
  idleTimeoutMs: 30_000,
};

export interface OutgoingRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer | null;
}

export interface FetchedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface FetchOptions {
  kind: RequestKind;
  // Documento principal: o redirecionamento volta para quem chamou, que navega de novo.
  followRedirects: boolean;
  limits: FetchLimits;
  signal: AbortSignal;
}

// Requisição recusada pela proteção contra SSRF.
export class BlockedError extends Error {
  readonly blocked = true;
}

// Recurso acima de `maxResourceBytes`.
export class TooLargeError extends Error {}

export const isBlockedError = (error: unknown): error is BlockedError =>
  error instanceof Error && (error as Partial<BlockedError>).blocked === true;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Cabeçalhos que dizem respeito à conexão, não ao recurso. `accept-encoding` é substituído
// pelos formatos que o Node sabe descompactar.
const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "content-length",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "accept-encoding",
]);

// O corpo entregue ao Chromium já está descompactado e com o tamanho que ele mesmo calcula.
const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "trailer",
  "upgrade",
  "content-encoding",
  "content-length",
]);

const ACCEPT_ENCODING = "gzip, deflate, br";

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const inflateRaw = promisify(zlib.inflateRaw);
const brotli = promisify(zlib.brotliDecompress);

export async function fetchResource(
  request: OutgoingRequest,
  policy: SsrfPolicy,
  options: FetchOptions,
): Promise<FetchedResponse> {
  let current: OutgoingRequest = { ...request, headers: outgoingHeaders(request.headers) };

  for (let redirects = 0; ; redirects++) {
    const response = await fetchOnce(current, policy, options);
    const location = response.headers.location;
    if (!options.followRedirects || !REDIRECT_STATUSES.has(response.status) || location === undefined) {
      return response;
    }
    if (redirects >= options.limits.maxRedirects) {
      throw new Error(`mais de ${options.limits.maxRedirects} redirecionamentos`);
    }
    current = redirectRequest(current, response.status, location);
  }
}

// Próximo salto, com as regras do navegador: 303 (e 301/302 de POST) vira GET sem corpo.
// Cookie e Authorization do Chromium valem para a origem original: não seguem para outra.
function redirectRequest(previous: OutgoingRequest, status: number, location: string): OutgoingRequest {
  const next = new URL(location, previous.url);
  const toGet = status === 303 ? previous.method !== "HEAD" : (status === 301 || status === 302) && previous.method === "POST";
  const headers = { ...previous.headers };
  if (toGet) {
    delete headers["content-type"];
  }
  if (next.origin !== new URL(previous.url).origin) {
    delete headers.cookie;
    delete headers.authorization;
  }
  return {
    url: next.href,
    method: toGet ? "GET" : previous.method,
    headers,
    body: toGet ? null : previous.body,
  };
}

function outgoingHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (key.startsWith(":") || DROP_REQUEST_HEADERS.has(key)) continue;
    result[key] = value;
  }
  result["accept-encoding"] = ACCEPT_ENCODING;
  return result;
}

async function fetchOnce(
  request: OutgoingRequest,
  policy: SsrfPolicy,
  options: FetchOptions,
): Promise<FetchedResponse> {
  // Cada salto passa pela mesma checagem; o IP dos nomes é conferido no `lookup`.
  const check = checkUrl(request.url, policy, options.kind);
  if (!check.ok) throw new BlockedError(check.detail);

  const { url, host, allowlisted } = check;
  const client = url.protocol === "https:" ? https : http;

  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = client.request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port === "" ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers: request.headers,
        lookup: validatingLookup(policy, allowlisted),
        // Conexão nova por requisição: cada uma resolve e valida o próprio IP.
        agent: false,
        signal: options.signal,
        timeout: options.limits.idleTimeoutMs,
      },
      resolve,
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("tempo esgotado sem resposta")));
    outgoing.on("error", reject);
    outgoing.end(request.body ?? undefined);
  });

  const raw = await readBody(response, options.limits.maxResourceBytes);
  const body = await decode(raw, response.headers["content-encoding"], options.limits.maxResourceBytes);

  return {
    url: url.href,
    status: response.statusCode ?? 502,
    headers: responseHeaders(response.headers),
    body,
  };
}

function validatingLookup(policy: SsrfPolicy, allowlisted: boolean): LookupFunction {
  return (hostname, options, callback) => {
    const done = callback as (error: Error | null, address?: unknown, family?: number) => void;
    policy
      .resolve(hostname)
      .then((addresses) => {
        if (!allowlisted) {
          const blocked = addresses.find(({ address }) => policy.isBlockedIp(address));
          if (blocked) throw new BlockedError(`${hostname} resolve para endereço proibido: ${blocked.address}`);
        }
        const family = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = family === 0 ? addresses : addresses.filter((a) => a.family === family);
        const first = usable[0];
        if (first === undefined) {
          throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
        }
        if (options.all) done(null, usable);
        else done(null, first.address, first.family);
      })
      .catch((error: Error) => done(error));
  };
}

function readBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy(new TooLargeError(`recurso passou de ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", reject);
    response.on("close", () => {
      if (!response.complete) reject(new Error("conexão encerrada antes do fim da resposta"));
    });
  });
}

const isSizeError = (error: unknown) =>
  error instanceof RangeError || (error as { code?: string } | null)?.code === "ERR_BUFFER_TOO_LARGE";

// Descompacta na ordem inversa da aplicada (`gzip, br` = br primeiro). O limite vale para o
// resultado: um arquivo pequeno que descompacta em gigabytes é recusado.
async function decode(raw: Buffer, header: string | undefined, maxBytes: number): Promise<Buffer> {
  const encodings = (header ?? "")
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter((encoding) => encoding !== "" && encoding !== "identity")
    .reverse();

  let body = raw;
  for (const encoding of encodings) {
    if (body.length === 0) break;
    const options = { maxOutputLength: maxBytes };
    const input = body;
    try {
      if (encoding === "gzip" || encoding === "x-gzip") body = await gunzip(input, options);
      else if (encoding === "br") body = await brotli(input, options);
      // `deflate` deveria ter o cabeçalho zlib, mas há servidores que mandam o fluxo cru.
      else if (encoding === "deflate")
        body = await inflate(input, options).catch((error: unknown) =>
          isSizeError(error) ? Promise.reject(error) : inflateRaw(input, options),
        );
      else throw new Error(`codificação não suportada: ${encoding}`);
    } catch (error) {
      if (isSizeError(error)) throw new TooLargeError(`recurso passou de ${maxBytes} bytes depois de descompactado`);
      throw error;
    }
  }
  return body;
}

// `route.fulfill` recebe um texto por cabeçalho; vários Set-Cookie vão separados por `\n`,
// que o Playwright divide antes de entregar ao Chromium.
function responseHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || DROP_RESPONSE_HEADERS.has(name)) continue;
    result[name] = Array.isArray(value) ? value.join(name === "set-cookie" ? "\n" : ", ") : value;
  }
  return result;
}
