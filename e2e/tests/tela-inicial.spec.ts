import { expect, test } from "@playwright/test";
import { axeViolations } from "./a11y.js";
import {
  AUDIT_ID,
  PhoenixMock,
  TEXT_SPACING,
  horizontalOverflow,
  mockAuditApi,
  progress,
} from "./simulado.js";

// Tela inicial (TelaInicial, RF-RA001) com a API simulada: formulário, erros ligados ao campo
// e a ida para a tela de progresso. O axe roda também com a mensagem de erro na tela.

test.describe("Tela inicial: formulário de auditoria", () => {
  test("RF-RA001 CA1: URL válida leva à tela de progresso, com o foco no h1", async ({ page }) => {
    const state = { revision: 1, progress: progress({ status: "queued" }) };
    const phoenix = new PhoenixMock(state);
    await phoenix.install(page);
    await mockAuditApi(page, state);
    let body: unknown = null;
    await page.route("**/api/audits", async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ status: 202, json: { id: AUDIT_ID } });
    });

    await page.goto("/");
    await page.getByRole("textbox", { name: "Endereço do site" }).fill("exemplo.com.br");
    await page.keyboard.press("Enter");

    const h1 = page.getByRole("heading", { level: 1, name: "Auditando exemplo.com.br" });
    await expect(h1).toBeFocused();
    await expect(page).toHaveURL(`/auditorias/${AUDIT_ID}`);
    await expect(page).toHaveTitle("Auditando exemplo.com.br – Rampa");
    expect(body).toEqual({ url: "exemplo.com.br" });
  });

  for (const [url, code, message] of [
    ["ftp://exemplo.com", "unsupported_scheme", "Só endereços web (http:// ou https://) podem ser auditados."],
    ["http://localhost:4000", "blocked_address", "Este endereço não pode ser auditado. O Rampa só acessa sites públicos, nas portas 80 e 443."],
  ] as const) {
    test(`422 ${code}: a mensagem aparece ligada ao campo, com o foco nele, e o axe não aponta nada`, async ({ page }) => {
      await page.route("**/api/audits", (route) =>
        route.fulfill({ status: 422, json: { error: { code, message } } }),
      );
      await page.goto("/");
      const input = page.getByRole("textbox", { name: "Endereço do site" });
      await input.fill(url);
      await page.getByRole("button", { name: "Auditar" }).click();

      await expect(page.getByRole("alert")).toHaveText(`Erro: ${message}`);
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveAccessibleDescription(new RegExp(`^Erro: ${message.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
      await expect(page).toHaveURL("/");
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("429 com retry_after: diz a partir de que horas tentar de novo", async ({ page }) => {
    const retry = new Date(Date.now() + 30 * 60_000);
    await page.route("**/api/audits", (route) =>
      route.fulfill({
        status: 429,
        headers: { "Retry-After": "1800" },
        json: { error: { code: "rate_limited", message: "Você atingiu o limite.", retry_after: retry.toISOString() } },
      }),
    );
    await page.goto("/");
    await page.getByRole("textbox", { name: "Endereço do site" }).fill("exemplo.com.br");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText(/Tente de novo a partir (das \d{2}:\d{2}|de \d{2}\/\d{2}\/\d{4}, às \d{2}:\d{2})\./);
    await expect(page.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
  });

  test("sem rede: mensagem do cliente, sem trocar de tela", async ({ page }) => {
    await page.route("**/api/audits", (route) => route.abort("internetdisconnected"));
    await page.goto("/");
    await page.getByRole("textbox", { name: "Endereço do site" }).fill("exemplo.com.br");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText(
      "Erro: Não conseguimos falar com o Rampa. Confira a sua conexão e tente de novo.",
    );
    await expect(page).toHaveURL("/");
  });

  test("ordem do Tab: pular, logo, navegação, campo, Auditar", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Pular para o conteúdo" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Rampa, página inicial" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Nova auditoria" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("textbox", { name: "Endereço do site" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Auditar" })).toBeFocused();
  });

  test("320px, zoom de 200% e espaçamento de texto não criam rolagem horizontal nem escondem o formulário", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // No mobile, o botão Auditar tem pelo menos 44px de altura.
    const box = await page.getByRole("button", { name: "Auditar" }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await page.setViewportSize({ width: 640, height: 480 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.addStyleTag({ content: TEXT_SPACING });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("textbox", { name: "Endereço do site" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Auditar" })).toBeVisible();
  });

  test("com forced-colors e com movimento reduzido, o axe não aponta nada", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("com movimento reduzido, nada fica animando", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getTiming().duration) > 1).length,
    );
    expect(running).toBe(0);
  });
});
