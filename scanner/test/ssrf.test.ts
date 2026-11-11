import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBlockedIp } from "../src/ssrf/ip.js";
import { checkStartup, checkUrl, defaultPolicy, normalizeHost, parseAllowlist } from "../src/ssrf/policy.js";

// Casos compartilhados com o backend (`backend/test/rampa/security/url_guard_test.exs`).
interface SharedCases {
  ips: { ip: string; blocked: boolean; range: string }[];
  urls: { url: string; expected: string; allowlist?: string[]; normalized?: string; backend_only?: string }[];
}

const cases = JSON.parse(
  readFileSync(new URL("../../shared/ssrf-cases.json", import.meta.url), "utf8"),
) as SharedCases;

describe("casos compartilhados com o backend: IPs", () => {
  it.each(cases.ips)("$ip ($range) proibido = $blocked", ({ ip, blocked }) => {
    expect(isBlockedIp(ip)).toBe(blocked);
  });
});

describe("casos compartilhados com o backend: URLs", () => {
  it.each(cases.urls.filter((c) => c.backend_only === undefined))("$url (allowlist $allowlist) → $expected", ({ url, expected, allowlist, normalized }) => {
    // A lista passa pela mesma interpretação da variável de ambiente, como no backend.
    const hosts = parseAllowlist((allowlist ?? []).join(","));
    const check = checkUrl(url, defaultPolicy({ allowlist: new Set(hosts) }));
    expect(check.ok ? "ok" : check.reason).toBe(expected);
    // IDN: o WHATWG URL e o URLGuard do backend precisam chegar à mesma URL. O backend tira
    // o ponto final do host (RF-RA001); aqui ele sai pelo `normalizeHost` do scanner.
    if (normalized !== undefined && check.ok) {
      const url = new URL(check.url.href);
      url.hostname = normalizeHost(url.hostname);
      expect(url.href).toBe(normalized);
    }
  });
});

describe("isBlockedIp", () => {
  it("trata como proibido o que não é IP", () => {
    for (const value of ["", "exemplo.com", "1.2.3", "999.0.0.1", "::g", "1::2::3"]) {
      expect(isBlockedIp(value), value).toBe(true);
    }
  });

  it("aceita colchetes e ignora o escopo do IPv6", () => {
    expect(isBlockedIp("[::1]")).toBe(true);
    expect(isBlockedIp("fe80::1%eth0")).toBe(true);
    expect(isBlockedIp("[2606:4700:4700::1111]")).toBe(false);
  });
});

describe("checkUrl", () => {
  const policy = defaultPolicy();

  it("só aceita as portas 80 e 443, em qualquer requisição", () => {
    for (const url of ["https://cdn.exemplo.com:8443/a.png", "http://8.8.8.8:8080/x.png", "https://exemplo.com:22/"]) {
      expect(checkUrl(url, policy), url).toMatchObject({ ok: false, reason: "blocked_address" });
    }
    expect(checkUrl("https://cdn.exemplo.com:8443/a.png", policy)).toMatchObject({ detail: "porta não permitida: 8443" });
    expect(checkUrl("http://cdn.exemplo.com:80/a.png", policy).ok).toBe(true);
    expect(checkUrl("https://cdn.exemplo.com/a.png", policy).ok).toBe(true);
  });

  it("a porta injetada vale só para a política que a recebeu", () => {
    const local = defaultPolicy({ ports: new Set([80, 443, 4321]) });
    expect(checkUrl("http://exemplo.com:4321/", local).ok).toBe(true);
    expect(checkUrl("http://exemplo.com:8080/", local).ok).toBe(false);
    expect(checkUrl("http://exemplo.com:4321/", defaultPolicy()).ok).toBe(false);
  });

  it("recusa IP proibido", () => {
    expect(checkUrl("http://192.168.0.1/x.png", policy)).toMatchObject({
      ok: false,
      reason: "blocked_address",
      detail: "endereço proibido: 192.168.0.1",
    });
    expect(checkUrl("http://[::1]/", policy).ok).toBe(false);
  });

  it("devolve o host normalizado e diz se é IP literal", () => {
    expect(checkUrl("http://EXEMPLO.com./a", policy)).toMatchObject({
      ok: true,
      host: "exemplo.com",
      ip: null,
      allowlisted: false,
    });
    expect(checkUrl("http://[2606:4700:4700::1111]/", policy)).toMatchObject({
      ok: true,
      host: "2606:4700:4700::1111",
      ip: "2606:4700:4700::1111",
    });
  });

  it("a allowlist libera o nome, não a porta", () => {
    const allow = defaultPolicy({ allowlist: new Set(["fixtures"]) });
    expect(checkUrl("http://fixtures/limpa.html", allow)).toMatchObject({ ok: true, allowlisted: true });
    expect(checkUrl("http://fixtures:8080/", allow).ok).toBe(false);
    expect(checkUrl("http://fixtures:8080/a.png", allow).ok).toBe(false);
    expect(checkUrl("http://postgres/", allow).ok).toBe(false);
  });
});

describe("checkStartup", () => {
  it("em produção, com a lista preenchida, recusa subir e explica o motivo", () => {
    const result = checkStartup("production", ["fixtures"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/SSRF_ALLOWLIST está preenchida em produção \(fixtures\)/);
  });

  it("em produção, com a lista vazia, sobe sem aviso", () => {
    expect(checkStartup("production", [])).toEqual({ ok: true, warning: null });
  });

  it("fora de produção sobe e avisa", () => {
    for (const env of ["test", "development", undefined]) {
      expect(checkStartup(env, ["fixtures"])).toEqual({
        ok: true,
        warning: "SSRF_ALLOWLIST preenchida: fixtures sem checagem de nome e de IP",
      });
    }
  });
});

describe("parseAllowlist", () => {
  it("é vazia por padrão", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist(" , ")).toEqual([]);
  });

  it("separa por vírgula, normaliza e remove repetidos", () => {
    expect(parseAllowlist(" fixtures, FIXTURES. ,outro.test")).toEqual(["fixtures", "outro.test"]);
  });

  it("tira os colchetes do IPv6, como o backend", () => {
    expect(parseAllowlist("[::1], FD00::1")).toEqual(["::1", "fd00::1"]);
  });
});
