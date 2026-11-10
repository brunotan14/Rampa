import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedIp } from "./ip.js";

// Regras de esquema, nome e porta da proteção contra SSRF (RF-RA002), as mesmas do backend
// (`Rampa.Security.URLGuard`). O scanner recebe URLs já validadas, mas confere de novo cada
// requisição da página: documento, redirecionamentos e sub-recursos.

export type BlockReason = "blocked_address" | "unsupported_scheme" | "invalid_url";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolve = (hostname: string) => Promise<ResolvedAddress[]>;

export interface SsrfPolicy {
  // `SSRF_ALLOWLIST`: hosts que pulam a checagem de nome e de IP, nunca a de esquema e porta.
  allowlist: ReadonlySet<string>;
  // Portas aceitas para o documento principal. Sub-recurso em outra porta não é SSRF: o
  // que importa nele é o IP.
  documentPorts: ReadonlySet<number>;
  // DNS; substituível nos testes (simulação de rebinding).
  resolve: Resolve;
  // Faixas proibidas; substituível só nos testes, para tratar um endereço local como público.
  isBlockedIp: (ip: string) => boolean;
}

export type RequestKind = "document" | "subresource";

export type UrlCheck =
  | { ok: true; url: URL; host: string; ip: string | null; allowlisted: boolean }
  | { ok: false; reason: BlockReason; detail: string };

const INTERNAL_SUFFIXES = ["localhost", "local", "internal", "localdomain", "home.arpa"];
const DEFAULT_PORTS: Record<string, number> = { "http:": 80, "https:": 443 };

export const defaultResolve: Resolve = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, order: "verbatim" });
  return addresses.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
};

export function defaultPolicy(overrides: Partial<SsrfPolicy> = {}): SsrfPolicy {
  return {
    allowlist: new Set(),
    documentPorts: new Set([80, 443]),
    resolve: defaultResolve,
    isBlockedIp,
    ...overrides,
  };
}

// Valor de `SSRF_ALLOWLIST`: separado por vírgula, normalizado, sem vazios.
export function parseAllowlist(value: string | undefined): string[] {
  const hosts = (value ?? "")
    .split(",")
    .map((host) => normalizeHost(host.trim()))
    .filter((host) => host !== "");
  return [...new Set(hosts)];
}

// Host em minúsculas, sem ponto final e sem os colchetes do IPv6.
export function normalizeHost(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

// Sem ponto cobre os nomes do Docker (`postgres`, `app`, `scanner`, `fixtures`).
export function isInternalName(host: string): boolean {
  return (
    !host.includes(".") ||
    INTERNAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  );
}

const block = (reason: BlockReason, detail: string): UrlCheck => ({ ok: false, reason, detail });

// Checagem sem DNS: esquema, credenciais, nome, IP literal e, para o documento, porta. O IP
// dos nomes é conferido na conexão (`fetchResource`), com o endereço que vai ser usado.
export function checkUrl(input: string | URL, policy: SsrfPolicy, kind: RequestKind): UrlCheck {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    return block("invalid_url", "URL inválida");
  }

  const defaultPort = DEFAULT_PORTS[url.protocol];
  if (defaultPort === undefined) return block("unsupported_scheme", `esquema não permitido: ${url.protocol}`);
  if (url.username !== "" || url.password !== "") return block("invalid_url", "URL com credenciais");

  const host = normalizeHost(url.hostname);
  if (host === "") return block("invalid_url", "URL sem host");

  const port = url.port === "" ? defaultPort : Number(url.port);
  if (kind === "document" && !policy.documentPorts.has(port)) {
    return block("blocked_address", `porta não permitida: ${port}`);
  }

  const ip = isIP(host) === 0 ? null : host;
  if (policy.allowlist.has(host)) return { ok: true, url, host, ip, allowlisted: true };
  if (ip !== null && policy.isBlockedIp(ip)) return block("blocked_address", `endereço proibido: ${ip}`);
  if (ip === null && isInternalName(host)) return block("blocked_address", `nome interno: ${host}`);

  return { ok: true, url, host, ip, allowlisted: false };
}
