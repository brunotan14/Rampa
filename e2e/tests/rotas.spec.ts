import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "./a11y.js";

// Rotas da base do frontend (M2, feat/frontend-base): o aviso de tela em construção das rotas
// do relatório e o 404, com axe, teclado, reflow e espaçamento de texto. A própria auditoria
// (`/auditorias/:id`) tem a tela de progresso (`tela-progresso.spec.ts`).
const AUDIT = "3f2b8c1e-7a4d-4e5f-9b0c-1d2e3f4a5b6c";
const SCREENS = [
  { path: `/auditorias/${AUDIT}/paginas`, h1: "Páginas da auditoria" },
  { path: "/auditorias/nao-e-um-id", h1: "Página não encontrada" },
  { path: "/nao-existe", h1: "Página não encontrada" },
];

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// Espaçamento de texto do critério 1.4.12 (o mesmo do bookmarklet).
const TEXT_SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

for (const { path, h1 } of SCREENS) {
  test.describe(`${path}`, () => {
    for (const media of [{ colorScheme: "light" }, { colorScheme: "dark" }, { contrast: "more" }] as const) {
      test(`não tem violações do axe (${JSON.stringify(media)})`, async ({ page }) => {
        await page.emulateMedia(media);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
        expect(await axeViolations(page)).toEqual([]);
      });
    }

    test("o h1 é igual ao título do documento e os marcos estão lá", async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(`${h1} – Rampa`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
      await expect(page.getByRole("main")).toHaveAttribute("id", "conteudo");
      await expect(page.getByRole("contentinfo")).toBeVisible();
    });

    test("320px, zoom de 200% e espaçamento de texto não criam rolagem horizontal", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(path);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await page.setViewportSize({ width: 640, height: 480 });
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await page.addStyleTag({ content: TEXT_SPACING });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "Voltar para a página inicial" })).toBeVisible();
    });
  });
}

test("na tela em construção, a ordem do Tab é pular, logo, navegação, voltar", async ({ page }) => {
  await page.goto(`/auditorias/${AUDIT}/paginas`);
  const order = ["Pular para o conteúdo", "Rampa, página inicial", "Nova auditoria", "Voltar para a página inicial"];
  for (const name of order) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name })).toBeFocused();
  }
});

test("seguir um link interno leva o foco ao h1 da nova tela e troca o título", async ({ page }) => {
  await page.goto(`/auditorias/${AUDIT}/paginas`);
  await page.getByRole("link", { name: "Voltar para a página inicial" }).focus();
  await page.keyboard.press("Enter");
  const h1 = page.getByRole("heading", { level: 1, name: "Seu site, para todo mundo" });
  await expect(h1).toBeFocused();
  await expect(page).toHaveTitle("Seu site, para todo mundo – Rampa");
  await expect(page.getByRole("link", { name: "Nova auditoria" })).toHaveAttribute("aria-current", "page");
});

test("o foco do teclado tem anel visível nos links da tela", async ({ page }) => {
  await page.goto(`/auditorias/${AUDIT}/paginas`);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  }
});

test.describe("logo no alto contraste do sistema", () => {
  async function fills(page: Page) {
    return page.evaluate(() => {
      const fill = (selector: string) => getComputedStyle(document.querySelector(selector)!).fill;
      return { ramp: fill(".rp-header .rp-logo__ramp"), fg: fill(".rp-header .rp-logo__fg") };
    });
  }

  for (const colorScheme of ["light", "dark"] as const) {
    test(`com contraste mais alto (${colorScheme}), a rampa usa on-action, como o tema contraste`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, contrast: "more" });
      await page.goto("/");
      const { ramp, fg } = await fills(page);
      expect(ramp).toBe(fg);
    });
  }

  test("sem preferência de contraste, a rampa mantém a cor do cerrado", async ({ page }) => {
    await page.emulateMedia({ contrast: "no-preference" });
    await page.goto("/");
    const { ramp, fg } = await fills(page);
    expect(ramp).not.toBe(fg);
  });

  test("com forced-colors, o logo continua com nome e o axe não aponta nada", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    await expect(page.getByRole("img", { name: "Rampa, página inicial" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
