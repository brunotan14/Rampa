import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { AXE_TAGS } from "../src/axe.js";

// SC-003 (specs/002-criterios-wcag-emag): todo critério WCAG citado pelas regras do axe que o
// Rampa roda (as tags de `AXE_TAGS`) está no catálogo `shared/wcag/criteria.pt-BR.json`, o mesmo
// arquivo que o backend compila (`Rampa.Wcag`). Sem isso, um achado real mostraria só o número
// do critério. Roda de novo a cada atualização do axe (Dependabot): critério novo citado por
// uma regra entra no catálogo no mesmo PR.
//
// O `axe-core` é o que o `@axe-core/playwright` injeta na página: resolvido a partir dele, sem
// dependência nova no scanner.

interface AxeRuleMetadata {
  ruleId: string;
  tags: string[];
}

interface AxeCore {
  version: string;
  getRules(tags?: string[]): AxeRuleMetadata[];
}

interface Criterion {
  id: string;
  level: string;
}

const require = createRequire(import.meta.url);
const playwrightEntry = require.resolve("@axe-core/playwright");
const fromPlaywright = createRequire(playwrightEntry);
const axe = fromPlaywright("axe-core") as AxeCore;
const axePackage = fromPlaywright("axe-core/package.json") as { version: string };

// O pacote `@axe-core/playwright` não exporta o `package.json`: lido ao lado do `dist/`.
const playwrightPackage = JSON.parse(readFileSync(join(dirname(playwrightEntry), "..", "package.json"), "utf8")) as {
  name?: string;
  dependencies?: Record<string, string>;
};

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const catalog = JSON.parse(read("../../shared/wcag/criteria.pt-BR.json")) as { criteria: Criterion[] };
const axeMapper = read("../../backend/lib/rampa/audits/axe_mapper.ex");

// A mesma regex do `Rampa.Audits.AxeMapper` (`@wcag_tag`), conferida abaixo.
const WCAG_TAG = /^wcag(\d)(\d)(\d+)$/;

function criteriaByRule(rules: AxeRuleMetadata[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const rule of rules) {
    for (const tag of rule.tags) {
      const match = WCAG_TAG.exec(tag);
      if (!match) continue;
      const id = `${match[1]}.${match[2]}.${match[3]}`;
      found.set(id, [...(found.get(id) ?? []), rule.ruleId]);
    }
  }
  return found;
}

describe("SC-003: cobertura das regras do axe pelo catálogo de critérios", () => {
  it("SC-003: o axe-core é o que o @axe-core/playwright usa, na versão que ele pede", () => {
    expect(playwrightPackage.name).toBe("@axe-core/playwright");
    expect(axe.version).toBe(axePackage.version);

    const range = playwrightPackage.dependencies?.["axe-core"];
    expect(range, "@axe-core/playwright precisa declarar a dependência axe-core").toBeDefined();
    const tilde = /^~(\d+)\.(\d+)\.(\d+)$/.exec(range ?? "");
    expect(tilde, `faixa do axe-core fora do formato esperado (~x.y.z): ${range ?? "?"}`).not.toBeNull();
    const [major, minor, patch] = axe.version.split(".").map(Number);
    expect([major, minor]).toEqual([Number(tilde?.[1]), Number(tilde?.[2])]);
    expect(patch).toBeGreaterThanOrEqual(Number(tilde?.[3]));
  });

  it("SC-003: a regex das tags é a mesma do AxeMapper do backend", () => {
    expect(axeMapper).toContain(`@wcag_tag ~r/${WCAG_TAG.source}/`);
  });

  it("SC-003: todo critério citado pelas regras de AXE_TAGS (inclusive deprecated e experimental) está no catálogo", () => {
    const rules = axe.getRules(AXE_TAGS);
    const found = criteriaByRule(rules);

    // Sem isso, uma mudança nas tags ou na regex deixaria o teste vazio e verde.
    expect(found.size, "nenhum critério extraído das regras do axe").toBeGreaterThanOrEqual(20);
    expect(found.has("1.1.1")).toBe(true);

    const known = new Set(catalog.criteria.map((criterion) => criterion.id));
    const missing = [...found.entries()]
      .filter(([id]) => !known.has(id))
      .map(([id, ruleIds]) => `${id} (${ruleIds.join(", ")})`);

    expect(
      missing,
      `critérios citados pelo axe ${axe.version} fora de shared/wcag/criteria.pt-BR.json: ` +
        "acrescente-os ao catálogo (os AAA com level \"AAA\")",
    ).toEqual([]);
  });

  it("SC-003 / CA1.6: o 2.1.3 da regra de região rolável está no catálogo como AAA", () => {
    const rule = axe.getRules(AXE_TAGS).find((r) => r.ruleId === "scrollable-region-focusable");
    expect(rule?.tags).toContain("wcag213");
    expect(catalog.criteria.find((c) => c.id === "2.1.3")?.level).toBe("AAA");
  });
});
