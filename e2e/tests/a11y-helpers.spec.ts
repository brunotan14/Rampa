import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { WCAG_TAGS, axeViolations, belowContrast, emulateOnly, paintContrast } from "./a11y.js";

// Os medidores de `a11y.ts` decidem se uma tela passa: cada caso aqui é um jeito de eles darem
// verde por engano (arredondamento, fundo presumido, pintura invisível, remedição pouco confiável).
// Páginas montadas com `setContent`, sem o app.

async function contrastOf(page: Page, html: string, selector = "#alvo", paint: "color" | "fill" | "stroke" = "color") {
  await page.setContent(html);
  return paintContrast(page, [{ selector, paint }], { checkDoubts: true });
}

test.describe("Medidor de contraste (a11y.ts)", () => {
  test("compara com a razão cheia: 2,9978:1 reprova no limiar de 3:1", async ({ page }) => {
    const parts = await contrastOf(page, `<p id="alvo" style="color: rgb(0, 166, 166); background: white">texto</p>`);
    expect(parts[0]!.ratio).toBeGreaterThan(2.99);
    expect(parts[0]!.ratio).toBeLessThan(3);
    expect(belowContrast(parts, 3)).toHaveLength(1);
    expect(belowContrast(parts, 3)[0]!.ratio).toBe(2.99);
  });

  test("sem fundo pintado, usa o Canvas do color-scheme da raiz (não branco fixo)", async ({ page }) => {
    const dark = await contrastOf(page, `<style>:root { color-scheme: dark }</style><p id="alvo" style="color: white">texto</p>`);
    expect(dark[0]!.backdrop).not.toBe("rgb(255, 255, 255)");
    expect(dark[0]!.ratio).toBeGreaterThan(15);
    const light = await contrastOf(page, `<p id="alvo" style="color: black">texto</p>`);
    expect(light[0]!.backdrop).toBe("rgb(255, 255, 255)");
    expect(light[0]!.ratio).toBeGreaterThan(15);
  });

  test("fundo translúcido é composto sobre o que está embaixo", async ({ page }) => {
    const parts = await contrastOf(
      page,
      `<div style="background: black"><p id="alvo" style="color: white; background: rgba(255, 255, 255, 0.5)">texto</p></div>`,
    );
    expect(parts[0]!.backdrop).toBe("rgb(128, 128, 128)");
  });

  for (const [name, style] of [
    ["fill: none", "fill: none"],
    ["fill: transparent", "fill: transparent"],
    ["fill-opacity: 0", "fill: black; fill-opacity: 0"],
    ["grupo com opacity: 0", "fill: black"],
    ["fill: url(#...)", "fill: url(#grad)"],
  ] as const) {
    test(`pintura invisível ou não medível reprova (${name})`, async ({ page }) => {
      const group = name.startsWith("grupo") ? ` style="opacity: 0"` : "";
      const parts = await contrastOf(
        page,
        `<svg width="40" height="40"><defs><linearGradient id="grad"><stop offset="0" stop-color="black"/></linearGradient></defs>
         <g${group}><rect id="alvo" width="40" height="40" style="${style}"/></g></svg>`,
        "#alvo",
        "fill",
      );
      expect(parts[0]!.problem).toBeDefined();
      expect(belowContrast(parts, 3)).toHaveLength(1);
    });
  }

  test("pintura com alfa é composta sobre o fundo", async ({ page }) => {
    const parts = await contrastOf(
      page,
      `<svg width="40" height="40" style="background: white"><rect id="alvo" width="40" height="40" style="fill: black; fill-opacity: 0.5"/></svg>`,
      "#alvo",
      "fill",
    );
    expect(parts[0]!.paint).toBe("rgb(128, 128, 128)");
    expect(parts[0]!.ratio).toBeLessThan(4);
  });

  for (const [name, html] of [
    ["texto simples sobre fundo opaco", `<p id="alvo" style="color: black; background: white">texto</p>`],
    [
      // Como a faixa lateral do `.rp-stat`: pintada, mas longe do texto.
      "pseudo-elemento absoluto que não encosta no texto",
      `<style>.card { position: relative; padding: 24px } .card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: black }</style>
       <div class="card"><p id="alvo">texto</p></div>`,
    ],
    [
      "link que quebra em várias linhas",
      `<p style="width: 120px">Antes <a id="alvo" href="#">um link comprido que quebra a linha</a> depois</p>`,
    ],
  ] as const) {
    test(`sem dúvidas: ${name}`, async ({ page }) => {
      const parts = await contrastOf(page, html);
      expect(parts[0]!.doubts).toEqual([]);
    });
  }

  for (const [name, html] of [
    ["imagem de fundo", `<div style="background-image: linear-gradient(white, black)"><p id="alvo">texto</p></div>`],
    ["opacidade < 1 no caminho", `<div style="opacity: 0.9"><p id="alvo">texto</p></div>`],
    [
      "pseudo-elemento com fundo",
      `<style>#alvo::before { content: ""; position: absolute; inset: 0; background: black }</style><p id="alvo" style="position: relative">texto</p>`,
    ],
    [
      "outro elemento por cima",
      `<p id="alvo">texto</p><div style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.01)"></div>`,
    ],
  ] as const) {
    test(`aponta dúvida: ${name}`, async ({ page }) => {
      const parts = await contrastOf(page, html);
      expect(parts[0]!.doubts).not.toEqual([]);
    });
  }
});

test.describe("Remedição do color-contrast no alto contraste escuro (dark + more + forced)", () => {
  const MEDIA = { colorScheme: "dark", contrast: "more", forcedColors: "active" } as const;

  test("tira o falso positivo: texto pintado em CanvasText sobre o Canvas", async ({ page }) => {
    await emulateOnly(page, MEDIA);
    await page.setContent(`<html lang="pt-BR"><title>t</title><style>:root { color-scheme: dark } body { background: white }</style><main><p style="color: rgb(40, 40, 40)">texto</p></main></html>`);
    // O axe sozinho acusa (lê a tinta do autor); a remedição tira.
    const raw = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(raw.violations.map((v) => v.id)).toContain("color-contrast");
    expect(await axeViolations(page)).toEqual([]);
  });

  test("mantém a violação real (forced-color-adjust: none com tinta escura)", async ({ page }) => {
    await emulateOnly(page, MEDIA);
    await page.setContent(
      `<html lang="pt-BR"><title>t</title><style>:root { color-scheme: dark } body { background: white }</style><main><p style="forced-color-adjust: none; color: rgb(40, 40, 40)">texto</p></main></html>`,
    );
    expect((await axeViolations(page)).join()).toContain("color-contrast");
  });

  test("na dúvida (opacidade no caminho), mantém o que o axe disse", async ({ page }) => {
    await emulateOnly(page, MEDIA);
    await page.setContent(
      `<html lang="pt-BR"><title>t</title><style>:root { color-scheme: dark } body { background: white }</style><main><div style="opacity: 0.95"><p style="color: rgb(40, 40, 40)">texto</p></div></main></html>`,
    );
    expect((await axeViolations(page)).join()).toContain("color-contrast");
  });
});
