import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isBlockedIp, parseIPv4, parseIPv6 } from "../src/ssrf/ip.js";
import { checkUrl, defaultPolicy, normalizeHost, parseAllowlist } from "../src/ssrf/policy.js";

// Propriedades da proteção contra SSRF no scanner (RF-RA002). Os exemplos fixos e os casos
// compartilhados com o backend ficam em `ssrf.test.ts`.

// Faixas proibidas repetidas de propósito, como especificação independente (PRD, RF-RA002, e os
// registros de propósito especial da IANA): se uma faixa sumir de `src/ssrf/ip.ts`, os IPs
// gerados dentro dela passam a ser aceitos e a propriedade falha. A mesma lista está nos testes
// do backend (`backend/test/support/ip_generators.ex`).
const IPV4_BLOCKED: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 0, 8],
  [10, 0, 0, 0, 8],
  [100, 64, 0, 0, 10],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 0, 0, 0, 24],
  [192, 0, 2, 0, 24],
  [192, 88, 99, 0, 24],
  [192, 168, 0, 0, 16],
  [198, 18, 0, 0, 15],
  [198, 51, 100, 0, 24],
  [203, 0, 113, 0, 24],
  [224, 0, 0, 0, 4],
  [240, 0, 0, 0, 4],
  [255, 255, 255, 255, 32],
];

const IPV6_BLOCKED: readonly (readonly [bigint, number])[] = [
  [0n, 96],
  [0x0064ff9b0001n << 80n, 48],
  [0x0100n << 112n, 64],
  [0x2001n << 112n, 23],
  [0x20010db8n << 96n, 32],
  [0x3fffn << 112n, 20],
  [0x5f00n << 112n, 16],
  [0xfc00n << 112n, 7],
  [0xfe80n << 112n, 10],
  [0xfec0n << 112n, 10],
  [0xff00n << 112n, 8],
];

const policy = defaultPolicy();

const bigintBelow = (bits: number) => fc.bigInt({ min: 0n, max: (1n << BigInt(bits)) - 1n });

const anyIPv4 = fc.integer({ min: 0, max: 0xffffffff });

const blockedIPv4 = fc.oneof(
  ...IPV4_BLOCKED.map(([a, b, c, d, prefix]) => {
    const network = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
    const free = 32 - prefix;
    return fc.integer({ min: 0, max: 2 ** free - 1 }).map((offset) => (network + offset) >>> 0);
  }),
);

const blockedIPv6 = fc.oneof(
  ...IPV6_BLOCKED.map(([network, prefix]) => bigintBelow(128 - prefix).map((offset) => network | offset)),
);

// IPv4 qualquer com metade das amostras dentro das faixas proibidas.
const mixedIPv4 = fc.oneof(anyIPv4, blockedIPv4);

const dotted = (value: number) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");

const groups = (value: bigint) =>
  Array.from({ length: 8 }, (_, i) => ((value >> BigInt((7 - i) * 16)) & 0xffffn).toString(16));

// Formas de escrever um IPv6: oito grupos, a forma comprimida do WHATWG URL e a mista, com os
// últimos 32 bits em notação IPv4 (`::ffff:a.b.c.d`).
type V6Style = "full" | "compressed" | "mixed";

function v6Text(value: bigint, style: V6Style): string {
  const all = groups(value);
  if (style === "full") return all.join(":");
  if (style === "mixed") return `${all.slice(0, 6).join(":")}:${dotted(Number(value & 0xffffffffn))}`;
  return new URL(`http://[${all.join(":")}]/`).hostname.slice(1, -1);
}

// As três formas IPv6 com IPv4 dentro: mapeado, NAT64 e 6to4 (com os 80 bits finais livres).
type Embedding = { kind: "mapped" } | { kind: "nat64" } | { kind: "6to4"; low: bigint };

const embedding: fc.Arbitrary<Embedding> = fc.oneof(
  fc.constant({ kind: "mapped" as const }),
  fc.constant({ kind: "nat64" as const }),
  bigintBelow(80).map((low) => ({ kind: "6to4" as const, low })),
);

function embed(ipv4: number, how: Embedding): bigint {
  const value = BigInt(ipv4);
  if (how.kind === "mapped") return (0xffffn << 32n) | value;
  if (how.kind === "nat64") return (0x64ff9bn << 96n) | value;
  return (0x2002n << 112n) | (value << 80n) | how.low;
}

const v6Style = fc.constantFrom<V6Style>("full", "compressed", "mixed");

// IP proibido como texto, em qualquer família e forma.
const blockedIpText = fc.oneof(
  blockedIPv4.map(dotted),
  fc.tuple(blockedIPv6, v6Style).map(([value, style]) => v6Text(value, style)),
  fc.tuple(blockedIPv4, embedding, v6Style).map(([ip, how, style]) => v6Text(embed(ip, how), style)),
);

// Notações IPv4 que o navegador aceita na URL e converte (`127.1`, `0x7f.0.0.1`, `2130706433`).
const ipv4UrlHost = fc.tuple(blockedIPv4, fc.constantFrom("dotted", "decimal", "hex", "octal")).map(([ip, notation]) => {
  const bytes = dotted(ip).split(".").map(Number);
  if (notation === "decimal") return String(ip);
  if (notation === "hex") return bytes.map((byte) => `0x${byte.toString(16)}`).join(".");
  if (notation === "octal") return bytes.map((byte) => `0${byte.toString(8)}`).join(".");
  return dotted(ip);
});

const label = fc.stringMatching(/^[a-z0-9]{1,10}$/);
const publicHost = fc
  .tuple(fc.array(label, { minLength: 1, maxLength: 3 }), fc.constantFrom("com", "com.br", "org", "net", "io"))
  .map(([labels, tld]) => [...labels, tld].join("."));

// Pedaços que já derrubaram ou quase derrubaram validações de URL.
const FRAGMENTS = [
  "http://", "https://", "//", ":", "@", "/", "?", "#", "%", "%00", "\0", "\t", "\n", " ", "\u00a0",
  "\u2028", "\u3000", "\ufeff", "\u200b", "\u202e", "。", "．", "[", "]", "::ffff:", "127.0.0.1",
  "0x7f", "xn--", "ação", "ｌｏｃａｌｈｏｓｔ", "localhost", "exemplo", ".com", ".", "-", "\\", "😀",
];

const anyText = fc.oneof(
  fc.string({ unit: "binary", maxLength: 60 }),
  fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code)), maxLength: 60 }),
  fc.array(fc.constantFrom(...FRAGMENTS), { maxLength: 12 }).map((parts) => parts.join("")),
);

describe("faixas proibidas (propriedades)", () => {
  it("todo IP dentro das faixas proibidas é proibido, em qualquer forma de escrever", () => {
    fc.assert(
      fc.property(blockedIpText, fc.boolean(), (ip, brackets) => {
        const text = brackets && ip.includes(":") ? `[${ip}]` : ip;
        expect(isBlockedIp(text), text).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("IPv4 mapeado em IPv6 é classificado igual ao IPv4 puro", () => {
    fc.assert(
      fc.property(mixedIPv4, v6Style, (ip, style) => {
        const mapped = v6Text(embed(ip, { kind: "mapped" }), style);
        expect(isBlockedIp(mapped), mapped).toBe(isBlockedIp(dotted(ip)));
      }),
      { numRuns: 500 },
    );
  });

  it("NAT64 e 6to4 também seguem o IPv4 embutido", () => {
    fc.assert(
      fc.property(mixedIPv4, embedding, v6Style, (ip, how, style) => {
        const text = v6Text(embed(ip, how), style);
        expect(isBlockedIp(text), text).toBe(isBlockedIp(dotted(ip)));
      }),
      { numRuns: 300 },
    );
  });

  it("as formas de escrever o mesmo IPv6 dão o mesmo número", () => {
    fc.assert(
      fc.property(fc.oneof(blockedIPv6, bigintBelow(128)), (value) => {
        for (const style of ["full", "compressed", "mixed"] as const) {
          expect(parseIPv6(v6Text(value, style)), style).toBe(value);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("checkUrl (propriedades)", () => {
  it("IP proibido literal na URL é recusado, em qualquer notação", () => {
    const host = fc.oneof(ipv4UrlHost, blockedIpText.map((ip) => (ip.includes(":") ? `[${ip}]` : ip)));
    fc.assert(
      fc.property(fc.constantFrom("http://", "https://"), host, (scheme, literal) => {
        const url = `${scheme}${literal}/x`;
        expect(checkUrl(url, policy), url).toMatchObject({ ok: false, reason: "blocked_address" });
      }),
      { numRuns: 500 },
    );
  });

  it("qualquer porta fora de 80 e 443 é recusada; acima de 65535 a URL nem interpreta", () => {
    // Portas de serviços conhecidos e das bordas aparecem sempre: sorteada em 0..200000, uma
    // porta como 8080 quase nunca sairia, e liberar uma porta a mais passaria despercebido.
    const port = fc.oneof(
      fc.constantFrom(0, 1, 21, 22, 25, 79, 81, 442, 444, 3000, 4000, 4100, 5432, 6379, 8000, 8080, 8443, 9200, 65535, 65536),
      fc.constantFrom(80, 443),
      fc.integer({ min: 0, max: 200_000 }),
    );
    fc.assert(
      fc.property(fc.constantFrom("http://", "https://"), publicHost, port, (scheme, host, port) => {
        const check = checkUrl(`${scheme}${host}:${port}/`, policy);
        if (port === 80 || port === 443) expect(check.ok).toBe(true);
        else if (port > 65535) expect(check).toMatchObject({ ok: false, reason: "invalid_url" });
        else expect(check).toMatchObject({ ok: false, reason: "blocked_address" });
      }),
      { numRuns: 500 },
    );
  });

  it("qualquer esquema que não seja http/https é recusado", () => {
    // Esquemas que o navegador conhece aparecem sempre; os sorteados cobrem o resto.
    const scheme = fc
      .oneof(
        fc.constantFrom("ws", "wss", "ftp", "file", "data", "blob", "javascript", "about", "chrome", "view-source", "gopher", "httpx", "http2", "shttp"),
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9+.-]{0,10}$/),
      )
      .filter((value) => !["http", "https"].includes(value.toLowerCase()));
    fc.assert(
      fc.property(scheme, fc.constantFrom("://", ":", ":/"), publicHost, (name, separator, host) => {
        const url = `${name}${separator}${host}/`;
        expect(checkUrl(url, policy), url).toMatchObject({ ok: false });
        expect(checkUrl(url, policy)).not.toMatchObject({ reason: "blocked_address" });
      }),
      { numRuns: 500 },
    );
  });

  it("entrada arbitrária nunca lança e só aceita http/https sem credenciais, na porta 80/443", () => {
    const input = fc.oneof(
      anyText,
      fc.tuple(fc.constantFrom("http://", "https://", "ftp://", "//", ""), anyText, publicHost, anyText).map((parts) => parts.join("")),
    );
    fc.assert(
      fc.property(input, (url) => {
        const check = checkUrl(url, policy);
        if (!check.ok) return;
        expect(["http:", "https:"]).toContain(check.url.protocol);
        expect(["", "80", "443"]).toContain(check.url.port);
        expect(check.url.username).toBe("");
        expect(check.url.password).toBe("");
        expect(check.host).not.toBe("");
      }),
      { numRuns: 1000 },
    );
  });

  it("as funções auxiliares nunca lançam com texto arbitrário", () => {
    fc.assert(
      fc.property(anyText, (value) => {
        expect(typeof isBlockedIp(value)).toBe("boolean");
        expect(() => parseIPv4(value)).not.toThrow();
        expect(() => parseIPv6(value)).not.toThrow();
        expect(typeof normalizeHost(value)).toBe("string");
        expect(Array.isArray(parseAllowlist(value))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
