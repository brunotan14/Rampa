import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBlockedIp } from "../src/ssrf/ip.js";
import { checkUrl, defaultPolicy, parseAllowlist } from "../src/ssrf/policy.js";

// Casos compartilhados com o backend (`backend/test/rampa/security/url_guard_test.exs`).
interface SharedCases {
  ips: { ip: string; blocked: boolean; range: string }[];
  urls: { url: string; expected: string; allowlist?: string[] }[];
}

const cases = JSON.parse(
  readFileSync(new URL("../../shared/ssrf-cases.json", import.meta.url), "utf8"),
) as SharedCases;

describe("casos compartilhados com o backend: IPs", () => {
  it.each(cases.ips)("$ip ($range) proibido = $blocked", ({ ip, blocked }) => {
    expect(isBlockedIp(ip)).toBe(blocked);
  });
});

describe("casos compartilhados com o backend: URLs do documento", () => {
  it.each(cases.urls)("$url (allowlist $allowlist) → $expected", ({ url, expected, allowlist }) => {
    const check = checkUrl(url, defaultPolicy({ allowlist: new Set(allowlist ?? []) }), "document");
    expect(check.ok ? "ok" : check.reason).toBe(expected);
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

  it("aceita sub-recurso público em qualquer porta, mas não o documento", () => {
    expect(checkUrl("https://cdn.exemplo.com:8443/a.png", policy, "subresource").ok).toBe(true);
    expect(checkUrl("https://cdn.exemplo.com:8443/", policy, "document")).toMatchObject({
      ok: false,
      reason: "blocked_address",
      detail: "porta não permitida: 8443",
    });
  });

  it("recusa sub-recurso com IP proibido em qualquer porta", () => {
    expect(checkUrl("http://192.168.0.1/x.png", policy, "subresource")).toMatchObject({
      ok: false,
      reason: "blocked_address",
      detail: "endereço proibido: 192.168.0.1",
    });
    expect(checkUrl("http://[::1]:8080/", policy, "subresource").ok).toBe(false);
  });

  it("devolve o host normalizado e diz se é IP literal", () => {
    expect(checkUrl("http://EXEMPLO.com./a", policy, "document")).toMatchObject({
      ok: true,
      host: "exemplo.com",
      ip: null,
      allowlisted: false,
    });
    expect(checkUrl("http://[2606:4700:4700::1111]/", policy, "document")).toMatchObject({
      ok: true,
      host: "2606:4700:4700::1111",
      ip: "2606:4700:4700::1111",
    });
  });

  it("a allowlist libera o nome, não a porta do documento", () => {
    const allow = defaultPolicy({ allowlist: new Set(["fixtures"]) });
    expect(checkUrl("http://fixtures/limpa.html", allow, "document")).toMatchObject({ ok: true, allowlisted: true });
    expect(checkUrl("http://fixtures:8080/", allow, "document").ok).toBe(false);
    expect(checkUrl("http://fixtures:8080/a.png", allow, "subresource").ok).toBe(true);
    expect(checkUrl("http://postgres/", allow, "document").ok).toBe(false);
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
});
