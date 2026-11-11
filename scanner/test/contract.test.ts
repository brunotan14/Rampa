import { describe, expect, it } from "vitest";
import { CONTRACT_LIMITS, CONTRACT_VERSION, SCAN_ERROR_CODES, SCAN_REQUEST_SCHEMA } from "../src/contract.gen.js";
import { limitAxe, scanError, scanResponse, truncate } from "../src/contract.js";
import { assertValid, contractSchema, ERROR_STATUS, validators } from "./support/contract.js";

type Definitions = Record<string, { const?: string; enum?: string[] }>;
const definitions = contractSchema.definitions as Definitions;

describe("schema do contrato", () => {
  it("o que foi gerado bate com o schema", () => {
    expect(CONTRACT_VERSION).toBe(definitions.ContractVersion?.const);
    expect([...SCAN_ERROR_CODES]).toEqual(definitions.ScanErrorCode?.enum);
    expect(SCAN_REQUEST_SCHEMA).toEqual(definitions.ScanRequest);
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...SCAN_ERROR_CODES].sort());
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

  it("nós por regra são cortados e o total fica em nodes_total", () => {
    const node = { target: ["img"], html: "<img>", failureSummary: null, impact: null };
    const rule = { id: "image-alt", impact: null, tags: [], description: "", help: "", helpUrl: "", nodes: Array(45).fill(node), nodes_total: 45 };
    const axe = limitAxe({ version: "4.14.0", violations: [rule], incomplete: [rule] });
    expect(axe.violations[0]?.nodes).toHaveLength(CONTRACT_LIMITS.nodes);
    expect(axe.violations[0]?.nodes_total).toBe(45);
    expect(axe.incomplete[0]?.nodes_total).toBe(45);
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
