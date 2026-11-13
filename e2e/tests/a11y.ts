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
  const violations = await recheckForcedDarkContrast(page, results.violations);
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

type AxeViolation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

/**
 * Falso `color-contrast` do axe no alto contraste escuro do Windows (dark + more + forced, a
 * única mídia em que isto vale). O axe lê a cor do texto em `-webkit-text-fill-color`, que o
 * Chromium devolve com a cor do autor mesmo em forced-colors (aqui, a tinta escura do `more`),
 * enquanto o fundo vem do Canvas preto do sistema: acusa ~1,5:1 num texto que o navegador pinta
 * em CanvasText/LinkText sobre o preto. Não se desliga a regra: cada nó acusado é medido de novo
 * com a `color` computada (a pintada, já com a cor do sistema) contra o fundo efetivo, e só sai
 * da lista se passar no limiar que o próprio axe pediu para ele. Outras regras e outras mídias
 * ficam como o axe disse.
 */
async function recheckForcedDarkContrast(page: Page, violations: AxeViolation[]): Promise<AxeViolation[]> {
  const forcedDark = await page.evaluate(
    () =>
      matchMedia("(forced-colors: active)").matches &&
      matchMedia("(prefers-color-scheme: dark)").matches &&
      matchMedia("(prefers-contrast: more)").matches,
  );
  if (!forcedDark) return violations;
  const result: AxeViolation[] = [];
  for (const violation of violations) {
    if (violation.id !== "color-contrast") {
      result.push(violation);
      continue;
    }
    const nodes = [];
    for (const node of violation.nodes) {
      const selector = node.target.length === 1 ? node.target[0] : undefined;
      const expected = parseFloat(String(node.any[0]?.data?.expectedContrastRatio ?? "4.5"));
      const [painted] = typeof selector === "string" ? await paintContrast(page, [{ selector, paint: "color" }]) : [];
      if (!painted || painted.ratio < expected) nodes.push(node);
    }
    if (nodes.length > 0) result.push({ ...violation, nodes });
  }
  return result;
}

// --- Checagens do RNF-RA001, as mesmas no `make e2e` e no E2E integrado ----------------------

/** Temas e mídias em que toda tela do Rampa passa no axe, uma de cada vez. */
export const A11Y_MEDIA = [
  { colorScheme: "light" },
  { colorScheme: "dark" },
  { contrast: "more" },
  { forcedColors: "active" },
  // Tema de alto contraste escuro do Windows ("Céu noturno"): o sistema entrega as três juntas.
  // Os tokens caem no `prefers-contrast: more` (tinta escura) e o Canvas do sistema é escuro.
  { colorScheme: "dark", contrast: "more", forcedColors: "active" },
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

export interface PaintContrast {
  part: string;
  paint: string;
  backdrop: string;
  ratio: number;
}

export interface PaintPart {
  selector: string;
  /** A propriedade que o navegador pinta: `color` no texto, `fill`/`stroke` no SVG. */
  paint: "color" | "fill" | "stroke";
  /** Elemento que fica atrás (o `fill` dele é o fundo); sem ele, o fundo efetivo do elemento. */
  over?: string;
}

/**
 * Contraste de cada parte contra o que está atrás dela, com as cores computadas, que são as que
 * o navegador pinta (em forced-colors, `color` e `background-color` já vêm com as do sistema).
 * `scope` limita a busca dos seletores (e do `over`) a um elemento.
 */
export async function paintContrast(page: Page, parts: PaintPart[], scope?: string): Promise<PaintContrast[]> {
  return page.evaluate(
    ({ parts, scope }) => {
      const rgba = (color: string) => {
        const n = color.match(/[\d.]+/g)?.map(Number) ?? [];
        return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n[3] ?? 1 };
      };
      const luminance = (color: string) => {
        const { r, g, b } = rgba(color);
        const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const ratio = (a: string, b: string) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      };
      const background = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (rgba(color).a > 0) return color;
        }
        return "rgb(255, 255, 255)";
      };
      const root: ParentNode | null = scope ? document.querySelector(scope) : document;
      if (!root) throw new Error(`Elemento não encontrado: ${scope}`);
      return parts.flatMap(({ selector, paint, over }) =>
        [...root.querySelectorAll(selector)].map((el, i) => {
          const behind = over ? getComputedStyle(root.querySelector(over)!).fill : background(el);
          const color = getComputedStyle(el)[paint];
          return { part: `${selector}[${i}]`, paint: color, backdrop: behind, ratio: ratio(color, behind) };
        }),
      );
    },
    { parts, scope },
  );
}

/** Contraste das partes de um SVG (fill/stroke), que o axe não mede. */
export function svgContrast(page: Page, svg: string, parts: PaintPart[]): Promise<PaintContrast[]> {
  return paintContrast(page, parts, svg);
}

/** Logotipo do cabeçalho: o ladrilho e a palavra contra o cabeçalho; o R do ladrilho contra o ladrilho. */
export function headerLogoContrast(page: Page): Promise<PaintContrast[]> {
  return svgContrast(page, ".rp-header .rp-logo", [
    { selector: ".rp-logo__tile", paint: "fill" },
    { selector: ".rp-logo__fg", paint: "fill", over: ".rp-logo__tile" },
    { selector: ".rp-logo__ramp", paint: "fill", over: ".rp-logo__tile" },
    { selector: ".rp-logo__ink", paint: "fill" },
    { selector: ".rp-logo__accent", paint: "fill" },
  ]);
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
