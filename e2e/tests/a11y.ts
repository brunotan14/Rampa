import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

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

// --- Checagens do RNF-RA001, as mesmas no `make e2e` e no E2E integrado ----------------------

/** Temas e mídias em que toda tela do Rampa passa no axe, uma de cada vez. */
export const A11Y_MEDIA = [
  { colorScheme: "light" },
  { colorScheme: "dark" },
  { contrast: "more" },
  { forcedColors: "active" },
  { reducedMotion: "reduce" },
] as const;
export type A11yMedia = (typeof A11Y_MEDIA)[number];

const NO_MEDIA = { colorScheme: null, contrast: null, forcedColors: null, reducedMotion: null } as const;

/**
 * Emula só esta mídia. O `emulateMedia` guarda o que veio antes: sem zerar, o forced-colors
 * rodaria com o dark e o contrast more da volta anterior do laço.
 */
export async function emulateOnly(page: Page, media: A11yMedia): Promise<void> {
  await page.emulateMedia({ ...NO_MEDIA, ...media });
}

/** O conteúdo que aparece ao rolar só entra quando chega à tela: rola até o fim antes do axe. */
export async function revealAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.documentElement.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));
    }
  });
}

// Espaçamento de texto do critério 1.4.12 (o mesmo do bookmarklet).
export const TEXT_SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

/** Rolagem horizontal da tela, em px (> 0 quebra o 1.4.10). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Acrescenta uma folha de estilo. O app servido pelo backend tem CSP (`style-src 'self'`), que
 * recusa o `addStyleTag`; uma folha construída (CSSOM) não passa pela CSP e muda o layout igual.
 */
export async function applyStyle(page: Page, css: string): Promise<void> {
  await page.evaluate((text) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, css);
}

/** Janela padrão do Playwright: 200% de zoom nela dá a viewport de 640 × 360 px CSS. */
const DESKTOP = { width: 1280, height: 720 };
const ZOOM_200 = { width: DESKTOP.width / 2, height: DESKTOP.height / 2 };
const REFLOW_320 = { width: 320, height: 640 };

export interface ReflowOverflow {
  /** 1.4.10: 320 px CSS de largura. */
  width320: number;
  /** 1.4.10: zoom de 200% (a viewport CSS cai pela metade; a fonte não é dobrada à mão). */
  zoom200: number;
  /** 1.4.12: espaçamento de texto na janela padrão, sem zoom. */
  textSpacing: number;
}

/**
 * Rolagem horizontal em cada situação, cada uma numa carga nova da tela (`open` navega e espera
 * a tela pronta), com movimento reduzido. Termina com o espaçamento aplicado na janela padrão:
 * quem chama pode conferir em seguida que o conteúdo continua visível.
 */
export async function reflowOverflow(page: Page, open: () => Promise<void>): Promise<ReflowOverflow> {
  await page.emulateMedia({ ...NO_MEDIA, reducedMotion: "reduce" });
  await page.setViewportSize(REFLOW_320);
  await open();
  const width320 = await horizontalOverflow(page);

  await page.setViewportSize(ZOOM_200);
  await open();
  const zoom200 = await horizontalOverflow(page);

  await page.setViewportSize(DESKTOP);
  await open();
  await applyStyle(page, TEXT_SPACING);
  const textSpacing = await horizontalOverflow(page);
  return { width320, zoom200, textSpacing };
}

/** Nenhuma das três situações de `reflowOverflow` cria rolagem horizontal. */
export function expectNoHorizontalScroll(reflow: ReflowOverflow): void {
  for (const [situation, overflow] of Object.entries(reflow)) expect(overflow, situation).toBeLessThanOrEqual(0);
}
