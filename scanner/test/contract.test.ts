import { describe, expect, it } from "vitest";
import { CONTRACT_LIMITS, CONTRACT_VERSION, SCAN_ERROR_CODES, SCAN_ERROR_STATUS, SCAN_REQUEST_SCHEMA } from "../src/contract.gen.js";
import { limitAxe, scanError, scanResponse, truncate } from "../src/contract.js";
import { assertValid, contractSchema, validators } from "./support/contract.js";

type Definitions = Record<string, { const?: string; enum?: string[]; "x-http-status"?: Record<string, number> }>;
const definitions = contractSchema.definitions as Definitions;

describe("schema do contrato", () => {
  it("o que foi gerado bate com o schema", () => {
    expect(CONTRACT_VERSION).toBe(definitions.ContractVersion?.const);
    expect([...SCAN_ERROR_CODES]).toEqual(definitions.ScanErrorCode?.enum);
    expect(SCAN_REQUEST_SCHEMA).toEqual(definitions.ScanRequest);
    expect(SCAN_ERROR_STATUS).toEqual(definitions.ScanErrorCode?.["x-http-status"]);
    expect(Object.keys(SCAN_ERROR_STATUS).sort()).toEqual([...SCAN_ERROR_CODES].sort());
  });

  it("a raiz aceita sucesso e erro, e recusa o resto", () => {
    expect(validators.reply(scanError("timeout", "x"))).toBe(true);
    expect(validators.reply(okResponse())).toBe(true);
    expect(validators.reply({ error: "timeout", detail: "x" })).toBe(false);
    expect(validators.reply({ ...okResponse(), contract_version: "2" })).toBe(false);
  });

  it.each(["contract_version", "final_url", "http_status", "title", "axe", "blocked_requests"])(
    "resposta sem %s é recusada",
    (field) => {
      const body: Record<string, unknown> = okResponse();
      delete body[field];
      expect(validators.response(body)).toBe(false);
    },
  );

  it("recusa campo desconhecido e status de erro na resposta de sucesso", () => {
    expect(validators.response({ ...okResponse(), extra: 1 })).toBe(false);
    expect(validators.response({ ...okResponse(), http_status: 404 })).toBe(false);
    expect(validators.response({ ...okResponse(), http_status: null })).toBe(true);
  });

  it("aceita login_wall só com o booleano (RF-RA028)", () => {
    expect(validators.response({ ...okResponse(), login_wall: { password_field: true } })).toBe(true);
    expect(validators.response({ ...okResponse(), login_wall: {} })).toBe(false);
    expect(validators.response({ ...okResponse(), login_wall: { password_field: "sim" } })).toBe(false);
    expect(validators.response({ ...okResponse(), login_wall: { password_field: true, html: "<input>" } })).toBe(false);
  });

  it("aceita http_status de 400 a 599 no erro (RF-RA029)", () => {
    expect(validators.error({ ...scanError("http_error", "HTTP 503"), http_status: 503 })).toBe(true);
    expect(validators.error({ ...scanError("http_error", "HTTP 200"), http_status: 200 })).toBe(false);
    expect(validators.error({ ...scanError("http_error", "HTTP 999"), http_status: 999 })).toBe(false);
  });

  it("valida o pedido", () => {
    expect(validators.request({ url: "https://exemplo.com/" })).toBe(true);
    expect(validators.request({ url: "https://exemplo.com/", options: { tab_limit: 100, max_images: 15 } })).toBe(true);
    expect(validators.request({ url: "ftp://exemplo.com/" })).toBe(false);
    expect(validators.request({})).toBe(false);
  });
});

describe("cortes", () => {
  it("truncate não separa um par substituto", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdef", 3)).toBe("abc");
    // "😀" ocupa duas unidades UTF-16: cortar no meio tira o caractere inteiro.
    expect(truncate("a😀b", 2)).toBe("a");
    expect(truncate("a😀b", 3)).toBe("a😀");
  });

  it("título, URL, detalhe e contador saem dentro dos limites", () => {
    const body = scanResponse({
      final_url: `https://exemplo.com/${"a".repeat(20_000)}`,
      http_status: 200,
      title: "t".repeat(5_000),
      axe: { version: "4.14.0", violations: [], incomplete: [] },
      blocked_requests: 1_000_000,
    });
    expect(body.contract_version).toBe(CONTRACT_VERSION);
    expect(body.final_url).toHaveLength(CONTRACT_LIMITS.finalUrl);
    expect(body.title).toHaveLength(CONTRACT_LIMITS.title);
    expect(body.blocked_requests).toBe(CONTRACT_LIMITS.blockedRequests);
    assertValid(validators.response, body, "resposta cortada");

    const error = scanError("navigation_failed", "log ".repeat(5_000));
    expect(error.detail).toHaveLength(CONTRACT_LIMITS.detail);
    assertValid(validators.error, error, "erro cortado");
  });

  it("http_status vai só no http_error e só dentro da faixa do contrato", () => {
    expect(scanError("http_error", "HTTP 503", 503)).toMatchObject({ http_status: 503 });
    expect(scanError("http_error", "HTTP 999", 999)).not.toHaveProperty("http_status");
    expect(scanError("http_error", "HTTP 200", 200)).not.toHaveProperty("http_status");
    expect(scanError("http_error", "HTTP 503")).not.toHaveProperty("http_status");
    expect(scanError("timeout", "lento", 503)).not.toHaveProperty("http_status");
  });

  it("login_wall sai só com o booleano, e fica de fora quando não veio", () => {
    const base = { final_url: "https://exemplo.com/", http_status: 200, title: "t", axe: { version: "4.14.0", violations: [], incomplete: [] }, blocked_requests: 0 };
    expect(scanResponse(base)).not.toHaveProperty("login_wall");
    const extra = { password_field: true, html: "<input>" } as unknown as { password_field: boolean };
    const body = scanResponse({ ...base, login_wall: extra });
    expect(body.login_wall).toEqual({ password_field: true });
    assertValid(validators.response, body, "resposta com login_wall");
  });

  it("target dentro dos limites sai inteiro, sem target_truncated", () => {
    const node = { target: ["iframe#a", ["#host", "button"]], html: "<button>", failureSummary: null, impact: null };
    const rule = { id: "button-name", impact: null, tags: [], description: "", help: "", helpUrl: "", nodes: [node], nodes_total: 1 };
    const [limited] = limitAxe({ version: "4.14.0", violations: [rule], incomplete: [] }).violations;
    expect(limited?.nodes[0]).toEqual(node);
    expect(limited?.nodes[0]).not.toHaveProperty("target_truncated");
  });

  it.each([
    ["seletor longo", ["#" + "a".repeat(CONTRACT_LIMITS.selector + 1)]],
    ["níveis de iframe demais", Array(CONTRACT_LIMITS.targetLevels + 1).fill("iframe")],
    ["níveis de shadow DOM demais", [Array(CONTRACT_LIMITS.shadowLevels + 1).fill("#host")]],
  ])("%s marca target_truncated", (_label, target) => {
    const node = { target, html: "<a>", failureSummary: null, impact: null };
    const rule = { id: "link-name", impact: null, tags: [], description: "", help: "", helpUrl: "", nodes: [node], nodes_total: 1 };
    const body = scanResponse({
      final_url: "https://exemplo.com/",
      http_status: 200,
      title: "",
      axe: { version: "4.14.0", violations: [rule], incomplete: [] },
      blocked_requests: 0,
    });
    expect(body.axe.violations[0]?.nodes[0]?.target_truncated).toBe(true);
    assertValid(validators.response, body, "resposta com target cortado");
  });

  it("o schema aceita target_truncated só como true", () => {
    const body = okResponse() as { axe: { violations: unknown[] } };
    const node = { target: ["a"], html: "<a>", failureSummary: null, impact: null };
    const rule = { id: "x", impact: null, tags: [], description: "", help: "", helpUrl: "", nodes_total: 1 };
    body.axe.violations = [{ ...rule, nodes: [{ ...node, target_truncated: true }] }];
    expect(validators.response(body)).toBe(true);
    body.axe.violations = [{ ...rule, nodes: [{ ...node, target_truncated: false }] }];
    expect(validators.response(body)).toBe(false);
  });

  it("limitRule não recalcula nodes_total", () => {
    const node = { target: ["img"], html: "<img>", failureSummary: null, impact: null };
    const rule = { id: "image-alt", impact: null, tags: [], description: "", help: "", helpUrl: "", nodes: [node], nodes_total: 30 };
    expect(limitAxe({ version: "4.14.0", violations: [rule], incomplete: [] }).violations[0]?.nodes_total).toBe(30);
  });

  it("nós por regra são cortados e o total fica em nodes_total", () => {
    const node = { target: ["img"], html: "<img>", failureSummary: null, impact: null };
    const rule = { id: "image-alt", impact: null, tags: [], description: "", help: "", helpUrl: "", nodes: Array(45).fill(node), nodes_total: 45 };
    const axe = limitAxe({ version: "4.14.0", violations: [rule], incomplete: [rule] });
    expect(axe.violations[0]?.nodes).toHaveLength(CONTRACT_LIMITS.nodes);
    expect(axe.violations[0]?.nodes_total).toBe(45);
    expect(axe.incomplete[0]?.nodes_total).toBe(45);
  });

  it("passes é opcional: sem ele a resposta continua válida e sem o campo", () => {
    const body = okResponse() as { axe: Record<string, unknown> };
    expect(body.axe).not.toHaveProperty("passes");
    expect(validators.response(body)).toBe(true);
  });

  it("regras aprovadas saem nos limites próprios de AxePass", () => {
    const hostile = {
      id: "r".repeat(CONTRACT_LIMITS.ruleId + 50),
      tags: Array.from({ length: 100 }, (_, i) => `t${i}`.padEnd(CONTRACT_LIMITS.tag + 10, "x")),
      help: "😀".repeat(CONTRACT_LIMITS.passHelp),
      nodes_total: 7,
    };
    const body = scanResponse({
      final_url: "https://exemplo.com/",
      http_status: 200,
      title: "",
      axe: { version: "4.14.0", violations: [], incomplete: [], passes: Array(CONTRACT_LIMITS.rules + 20).fill(hostile) },
      blocked_requests: 0,
    });
    const passes = body.axe.passes!;
    expect(passes).toHaveLength(CONTRACT_LIMITS.rules);
    expect(passes[0]!.id).toHaveLength(CONTRACT_LIMITS.ruleId);
    expect(passes[0]!.tags).toHaveLength(CONTRACT_LIMITS.passTags);
    expect(passes[0]!.tags[0]).toHaveLength(CONTRACT_LIMITS.tag);
    // `maxLength` conta pontos de código: 512 emojis de 2 unidades UTF-16 viram 256.
    expect([...passes[0]!.help]).toHaveLength(CONTRACT_LIMITS.passHelp / 2);
    assertValid(validators.response, body, "resposta com passes no limite");
  });

  it("o schema recusa regra aprovada com nós ou acima dos limites", () => {
    const body = okResponse() as { axe: Record<string, unknown> };
    const pass = { id: "image-alt", tags: ["wcag111"], help: "x", nodes_total: 1 };
    body.axe.passes = [pass];
    expect(validators.response(body)).toBe(true);
    body.axe.passes = [{ ...pass, nodes: [] }];
    expect(validators.response(body)).toBe(false);
    body.axe.passes = [{ ...pass, help: "x".repeat(CONTRACT_LIMITS.passHelp + 1) }];
    expect(validators.response(body)).toBe(false);
    body.axe.passes = [{ ...pass, tags: Array(CONTRACT_LIMITS.passTags + 1).fill("t") }];
    expect(validators.response(body)).toBe(false);
  });
});

function okResponse(): Record<string, unknown> {
  return scanResponse({
    final_url: "https://exemplo.com/",
    http_status: 200,
    title: "Início",
    axe: { version: "4.14.0", violations: [], incomplete: [] },
    blocked_requests: 0,
  }) as unknown as Record<string, unknown>;
}
