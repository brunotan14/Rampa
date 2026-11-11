import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import type { AxeFacts, AxeNode, AxeRule } from "./contract.gen.js";

// Varredura automática com axe-core (RF-RA003). O scanner só repassa os fatos: quem converte
// em achado, corta o HTML em 2 KB para gravar e decide a severidade é o backend.

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type RawRule = AxeResults["violations"][number];
type RawNode = RawRule["nodes"][number];

export async function runAxe(page: Page): Promise<AxeFacts> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return {
    version: results.testEngine.version,
    violations: results.violations.map(slimRule),
    incomplete: results.incomplete.map(slimRule),
  };
}

// Mantém só os campos do contrato (`shared/scanner-contract.schema.json`). `any`/`all`/`none`,
// `relatedNodes`, `xpath` e `ancestry` ficam de fora para o payload não crescer. Os cortes de
// tamanho (nós por regra, HTML) ficam em `contract.ts`, aplicados pelo servidor a toda resposta.
function slimRule(rule: RawRule): AxeRule {
  return {
    id: rule.id,
    impact: rule.impact ?? null,
    tags: rule.tags,
    description: rule.description,
    help: rule.help,
    helpUrl: rule.helpUrl,
    nodes: rule.nodes.map(slimNode),
    nodes_total: rule.nodes.length,
  };
}

function slimNode(node: RawNode): AxeNode {
  return {
    target: node.target,
    html: node.html,
    failureSummary: node.failureSummary ?? null,
    impact: node.impact ?? null,
  };
}
