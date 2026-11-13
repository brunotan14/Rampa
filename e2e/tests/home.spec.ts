import { expect, test } from "@playwright/test";
import {
  A11Y_MEDIA,
  LOGO_MIN_PARTS,
  axeViolations,
  belowContrast,
  emulateOnly,
  headerLogoContrast,
  horizontalOverflow,
  paintContrast,
  waitFiniteAnimations,
} from "./a11y.js";

test.describe("Página inicial (M0)", () => {
  for (const media of A11Y_MEDIA) {
    // O axe não mede SVG: o logotipo do cabeçalho e o anel da pontuação do exemplo são medidos
    // à parte (1.4.11, 3:1 com as cores pintadas). O traço e o preenchimento do SVG não são
    // forçados pelo navegador: sem as cores do sistema, no alto contraste escuro do Windows
    // (dark + more + forced) a palavra "Rampa" e o contorno do anel sumiam no Canvas preto.
    test(`sem violações do axe, logo e anel com 3:1 (${JSON.stringify(media)})`, async ({ page }) => {
      await emulateOnly(page, media);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);

      await waitFiniteAnimations(page);
      const logo = await headerLogoContrast(page);
      expect(logo.length).toBeGreaterThan(LOGO_MIN_PARTS);
      expect(belowContrast(logo, 3), "logo").toEqual([]);

      // Contorno contra a página; o arco contra a trilha, que fica atrás dele.
      const ring = await paintContrast(
        page,
        [
          { selector: ".rp-score__border", paint: "stroke" },
          { selector: ".rp-score__value", paint: "stroke", over: { selector: ".rp-score__track", paint: "stroke" } },
        ],
        { scope: ".rp-score__ring" },
      );
      expect(ring).toHaveLength(2);
      expect(belowContrast(ring, 3), "anel").toEqual([]);
    });
  }

  test("o primeiro Tab mostra o link de pular, e Enter leva ao conteúdo", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("o foco do teclado tem anel visível", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test("em 320px de largura não há rolagem horizontal (1.4.10)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("não carrega nada de terceiros (fontes servidas pelo app)", async ({ page, baseURL }) => {
    const external: string[] = [];
    page.on("request", (req) => {
      if (!req.url().startsWith(baseURL!) && !req.url().startsWith("data:")) external.push(req.url());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(external).toEqual([]);
  });
});
