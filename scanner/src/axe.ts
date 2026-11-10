import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";

// Varredura automática com axe-core (RF-RA003). O scanner só repassa os fatos:
// quem converte em achado, corta o HTML e decide a severidade é o backend.

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type AxeRule = AxeResults["violations"][number];
type AxeNode = AxeRule["nodes"][number];

export type Impact = "minor" | "moderate" | "serious" | "critical" | null;

export interface AxeNodeFacts {
  // Lista de seletores: um por nível de iframe. Um item que é lista indica shadow DOM.
  target: AxeNode["target"];
  html: string;
  failureSummary: string | null;
  impact: Impact;
}

export interface AxeRuleFacts {
  id: string;
  impact: Impact;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNodeFacts[];
}

export interface AxeFacts {
  version: string;
  violations: AxeRuleFacts[];
  incomplete: AxeRuleFacts[];
}

export async function runAxe(page: Page): Promise<AxeFacts> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return {
    version: results.testEngine.version,
    violations: results.violations.map(slimRule),
    incomplete: results.incomplete.map(slimRule),
  };
}

// Mantém só os campos do contrato (PRD §7). `any`/`all`/`none`, `relatedNodes`,
// `xpath` e `ancestry` ficam de fora para o payload não crescer.
function slimRule(rule: AxeRule): AxeRuleFacts {
  return {
    id: rule.id,
    impact: rule.impact ?? null,
    tags: rule.tags,
    description: rule.description,
    help: rule.help,
    helpUrl: rule.helpUrl,
    nodes: rule.nodes.map(slimNode),
  };
}

function slimNode(node: AxeNode): AxeNodeFacts {
  return {
    target: node.target,
    html: node.html,
    failureSummary: node.failureSummary ?? null,
    impact: node.impact ?? null,
  };
}
