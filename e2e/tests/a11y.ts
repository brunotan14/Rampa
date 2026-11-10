import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

// Mesmas regras que o Rampa aplica nos sites auditados (RF-RA003).
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}
