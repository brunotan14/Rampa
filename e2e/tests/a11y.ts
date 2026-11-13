import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

// Mesmas regras que o Rampa aplica nos sites auditados (RF-RA003).
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Violações do axe na tela pronta: espera as animações finitas (entrada em cascata, contagem,
 * azulejos) terminarem, para o contraste não ser medido no meio de um esmaecimento. As
 * infinitas (só o progresso real) não são esperadas.
 */
export async function axeViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

// Espaçamento de texto do critério 1.4.12 (o mesmo do bookmarklet).
export const TEXT_SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

/** Rolagem horizontal da tela, em px (> 0 quebra o 1.4.10). */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
