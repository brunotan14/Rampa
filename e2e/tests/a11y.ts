import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Mesmas regras que o Rampa aplica nos sites auditados (RF-RA003).
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Espera as animações finitas (entrada em cascata, contagem, azulejos) terminarem, para que
 * contraste e cores não sejam medidos no meio de um esmaecimento. As infinitas (só o progresso
 * real) não são esperadas: nunca terminariam.
 */
export async function waitFiniteAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** Violações do axe na tela pronta (depois das animações finitas). */
export async function axeViolations(page: Page) {
  await waitFiniteAnimations(page);
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
 * em CanvasText/LinkText sobre o preto.
 *
 * Não se desliga a regra. Cada nó acusado é medido de novo com a `color` computada (a pintada, já
 * com a cor do sistema) contra o fundo efetivo, e só sai da lista quando a nova medida é confiável
 * e passa no limiar que o próprio axe pediu para ele. É confiável quando o seletor do axe acha um
 * elemento só, a cor e o fundo são legíveis (sem `none`, transparente ou alfa 0) e nenhuma destas
 * dúvidas aparece (ver `doubts` em `paintContrast`): imagem de fundo ou pseudo-elemento com fundo
 * entre o texto e o fundo opaco, opacidade < 1 no caminho até a raiz, ou outro elemento por cima
 * do centro do nó. Em qualquer dúvida, a violação fica. Outras regras e outras mídias ficam como
 * o axe disse.
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
      const expected = parseFloat(String(node.any[0]?.data?.expectedContrastRatio ?? ""));
      const measured =
        typeof selector === "string" && Number.isFinite(expected)
          ? await paintContrast(page, [{ selector, paint: "color" }], { checkDoubts: true })
          : [];
      const [painted] = measured;
      const reliable = measured.length === 1 && painted!.problem === undefined && painted!.doubts.length === 0;
      if (!reliable || painted!.ratio < expected) nodes.push(node);
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

export type Paint = "color" | "fill" | "stroke";

export interface PaintPart {
  selector: string;
  /** A propriedade que o navegador pinta: `color` no texto, `fill`/`stroke` no SVG. */
  paint: Paint;
  /** Parte que fica atrás desta (a pintura dela é o fundo); sem ela, o fundo efetivo do elemento. */
  over?: { selector: string; paint: Paint };
}

export interface PaintContrast {
  part: string;
  paint: string;
  backdrop: string;
  /** Razão de contraste sem arredondar (compare com ela; arredonde só para mostrar). */
  ratio: number;
  /** Pintura ou fundo que não dá para medir ou que não aparece (`none`, `url(...)`, alfa 0): reprova. */
  problem?: string;
  /** Só com `checkDoubts`: o que torna a medida pouco confiável (ver `recheckForcedDarkContrast`). */
  doubts: string[];
}

/**
 * Contraste de cada parte contra o que está atrás dela, com as cores computadas, que são as que
 * o navegador pinta (em forced-colors, `color` e `background-color` já vêm com as do sistema).
 * A pintura com alfa (cor, `fill-opacity`/`stroke-opacity`) é composta sobre o fundo; o fundo é
 * a pilha de `background-color` dos ancestrais até o primeiro opaco, sobre o canvas da página
 * (`Canvas` no `color-scheme` da raiz, que é o que aparece quando ninguém pinta fundo).
 * `scope` limita a busca dos seletores (e do `over`) a um elemento.
 */
export async function paintContrast(
  page: Page,
  parts: PaintPart[],
  options: { scope?: string; checkDoubts?: boolean } = {},
): Promise<PaintContrast[]> {
  return page.evaluate(
    ({ parts, scope, checkDoubts }) => {
      type Rgba = { r: number; g: number; b: number; a: number };
      const RGB = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/;
      const parse = (color: string): Rgba | null => {
        const m = RGB.exec(color.trim());
        if (!m) return null;
        const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
      };
      const over = (top: Rgba, below: Rgba): Rgba => ({
        r: top.r * top.a + below.r * (1 - top.a),
        g: top.g * top.a + below.g * (1 - top.a),
        b: top.b * top.a + below.b * (1 - top.a),
        a: 1,
      });
      const show = ({ r, g, b }: Rgba) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
      const luminance = ({ r, g, b }: Rgba) => {
        const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const ratio = (a: Rgba, b: Rgba) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
        return (hi + 0.05) / (lo + 0.05);
      };

      // Canvas da página: a cor do sistema no color-scheme da raiz (sonda descartável).
      const probe = document.createElement("div");
      probe.style.backgroundColor = "Canvas";
      document.documentElement.append(probe);
      const canvas = parse(getComputedStyle(probe).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
      probe.remove();
      canvas.a = 1;

      const overlaps = (a: DOMRect, b: { left: number; top: number; right: number; bottom: number }) =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      /**
       * Se o pseudo-elemento pintado pode ficar atrás ou na frente do alvo. Só dá para afirmar que
       * não fica quando ele é absoluto dentro do próprio elemento (posicionado) e a caixa dele,
       * calculada pelos valores usados (px), não encosta em nenhuma linha do alvo, como a faixa
       * lateral do `.rp-stat`. Em qualquer outro caso, conta como dúvida.
       */
      const pseudoMayCover = (node: Element, style: CSSStyleDeclaration, ps: CSSStyleDeclaration, target: Element) => {
        if (ps.position !== "absolute" || style.position === "static") return true;
        const px = (v: string) => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : NaN);
        const [left, top, width, height] = [ps.left, ps.top, ps.width, ps.height].map(px) as [number, number, number, number];
        if (![left, top, width, height].every(Number.isFinite)) return true;
        const origin = node.getBoundingClientRect();
        const x = origin.left + px(style.borderLeftWidth) + left;
        const y = origin.top + px(style.borderTopWidth) + top;
        const box = { left: x, top: y, right: x + width, bottom: y + height };
        return [...target.getClientRects()].some((rect) => overlaps(rect, box));
      };

      /** Fundo efetivo: as camadas de fundo do elemento para cima, compostas sobre o canvas. */
      const backdrop = (el: Element, doubts: string[]) => {
        const layers: Rgba[] = [];
        for (let node: Element | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (checkDoubts) {
            if (style.backgroundImage !== "none") doubts.push(`imagem de fundo em ${node.tagName.toLowerCase()}`);
            for (const pseudo of ["::before", "::after"]) {
              const ps = getComputedStyle(node, pseudo);
              const bg = parse(ps.backgroundColor);
              const painted = (bg && bg.a > 0) || ps.backgroundImage !== "none";
              if (ps.content !== "none" && painted && pseudoMayCover(node, style, ps, el))
                doubts.push(`${pseudo} com fundo em ${node.tagName.toLowerCase()}`);
            }
          }
          const color = parse(style.backgroundColor);
          if (!color) {
            doubts.push(`fundo não medível: ${style.backgroundColor}`);
            continue;
          }
          if (color.a > 0) layers.push(color);
          if (color.a >= 1) break;
        }
        return layers.reverse().reduce((below, top) => over(top, below), canvas);
      };

      const opacityOf = (el: Element, paint: Paint) => {
        const style = getComputedStyle(el);
        const own = paint === "fill" ? Number(style.fillOpacity) : paint === "stroke" ? Number(style.strokeOpacity) : 1;
        let opacity = Number.isFinite(own) ? own : 1;
        // Dentro do SVG a opacidade dos grupos entra na conta da pintura; fora dele vira dúvida.
        for (let node: Element | null = el; node && node instanceof SVGElement; node = node.parentElement)
          opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      };

      type Paint = "color" | "fill" | "stroke";
      const root: ParentNode | null = scope ? document.querySelector(scope) : document;
      if (!root) throw new Error(`Elemento não encontrado: ${scope}`);

      /** A pintura de `el` composta sobre `below`; null (com o motivo) se não aparece ou não dá para ler. */
      const painted = (el: Element, paint: Paint, below: Rgba): { color: Rgba | null; raw: string; problem?: string } => {
        const raw = getComputedStyle(el)[paint];
        const color = parse(raw);
        if (!color) return { color: null, raw, problem: `pintura não medível ou ausente: ${raw}` };
        const alpha = color.a * opacityOf(el, paint);
        if (alpha <= 0) return { color: null, raw, problem: `pintura invisível (alfa 0): ${raw}` };
        return { color: over({ ...color, a: alpha }, below), raw };
      };

      return parts.flatMap(({ selector, paint, over: behindPart }) =>
        [...root.querySelectorAll(selector)].map((el, i) => {
          const doubts: string[] = [];
          const part = `${selector}[${i}]`;
          let behind: Rgba;
          let behindProblem: string | undefined;
          if (behindPart) {
            const under = root.querySelector(behindPart.selector);
            const base = backdrop(el, doubts);
            const measured = under ? painted(under, behindPart.paint, base) : { color: null, raw: "", problem: `${behindPart.selector} não encontrado` };
            behind = measured.color ?? base;
            behindProblem = measured.problem && `fundo (${behindPart.selector}): ${measured.problem}`;
          } else {
            behind = backdrop(el, doubts);
          }
          if (checkDoubts) {
            for (let node: Element | null = el; node; node = node.parentElement)
              if (Number(getComputedStyle(node).opacity) < 1) doubts.push(`opacidade < 1 em ${node.tagName.toLowerCase()}`);
            // Por cima: o centro de cada linha do alvo (texto que quebra tem várias caixas; o centro
            // da caixa externa pode cair fora do texto) tem de acertar o próprio alvo ou um filho.
            el.scrollIntoView({ block: "center", inline: "center" });
            const rects = [...el.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
            if (rects.length === 0) doubts.push("sem caixa visível");
            for (const rect of rects) {
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              if (!hit || !el.contains(hit)) {
                doubts.push(`outro elemento por cima: ${hit ? hit.tagName.toLowerCase() : "nenhum"}`);
                break;
              }
            }
          }
          const fg = painted(el, paint, behind);
          const problem = fg.problem ?? behindProblem;
          return {
            part,
            paint: fg.color ? show(fg.color) : fg.raw,
            backdrop: show(behind),
            ratio: fg.color && !behindProblem ? ratio(fg.color, behind) : 0,
            ...(problem ? { problem } : {}),
            doubts,
          };
        }),
      );
    },
    { parts, scope: options.scope, checkDoubts: options.checkDoubts ?? false },
  );
}

/**
 * As partes que reprovam: com problema (pintura ausente ou invisível) ou abaixo de `min`, com a
 * comparação feita na razão cheia. A razão vai arredondada só para a mensagem do teste.
 */
export function belowContrast(parts: PaintContrast[], min: number) {
  return parts
    .filter((p) => p.problem !== undefined || p.ratio < min)
    .map(({ doubts: _doubts, ...p }) => ({ ...p, ratio: Math.floor(p.ratio * 100) / 100 }));
}

/** Logotipo do cabeçalho: o ladrilho e a palavra contra o cabeçalho; o R do ladrilho contra o ladrilho. */
export function headerLogoContrast(page: Page): Promise<PaintContrast[]> {
  const tile = { selector: ".rp-logo__tile", paint: "fill" } as const;
  return paintContrast(
    page,
    [
      tile,
      { selector: ".rp-logo__fg", paint: "fill", over: tile },
      { selector: ".rp-logo__ramp", paint: "fill", over: tile },
      { selector: ".rp-logo__ink", paint: "fill" },
      { selector: ".rp-logo__accent", paint: "fill" },
    ],
    { scope: ".rp-header .rp-logo" },
  );
}

/** Peças do logotipo (ladrilho, R, rampa, palavra): menos que isso é seletor quebrado. */
export const LOGO_MIN_PARTS = 10;

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
