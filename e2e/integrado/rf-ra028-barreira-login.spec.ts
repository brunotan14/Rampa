import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "../tests/a11y.js";
import { createAudit, fixtureUrl, listPages, newClientIp, waitForAuditEnd } from "./support/api.js";
import { openBrowserPage } from "./support/browser.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";
import { messages, screenTexts } from "./support/messages.js";

// RF-RA028: aviso de barreira de login, pela API (`login_wall` da página e `login_wall_pages` do
// resumo) e pela tela (`feat/tela-relatorio`): o aviso com ícone e texto no resumo e no
// relatório da página, no frontend servido pelo app. O CA4 (medição) é provado nos testes do
// backend (`Rampa.Audits.LoginWallDailyTest`): a consulta é pela release, sem rota na API.
// RF-RA017 (aba "Aprovados") entra junto, na tela da `limpa.html`.

const CA1 =
  "RF-RA028 CA1: Dado uma URL que redireciona para uma página com campo de senha, quando a auditoria termina, então o relatório mostra o aviso de barreira de login na página e no resumo.";
const CA2 = "RF-RA028 CA2: Dado uma página que responde 401, quando a auditoria termina, então o aviso aparece.";
const CA3 = "RF-RA028 CA3: Dado a `limpa.html` (sem login), quando a auditoria termina, então não há aviso.";
const PRECISION =
  "RF-RA028 (decisão do §15): campo de senha sem redirecionamento (formulário de login numa página comum) não é barreira: precisão antes de cobertura.";

const PASSED_CA1 =
  "RF-RA017 CA1: Dado a fixture `limpa.html`, quando ela é varrida, então a aba \"Aprovados\" lista ao menos a regra `image-alt` com o selo \"Aprovado\".";
const PASSED_CA2 =
  "RF-RA017 CA2: Dado qualquer página, quando vejo a aba \"Aprovados\", então nenhum texto afirma que a página ou o site é acessível.";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

/** O aviso de barreira de login na tela: texto do PRD e ícone ao lado (nunca só cor). */
function loginWallNotice(page: Page) {
  return page.locator(".rp-notice", { hasText: screenTexts.loginWall });
}

test.describe("RF-RA028: aviso de barreira de login", () => {
  test(
    "RF-RA028 CA1: /painel redireciona para a tela de entrar: página e resumo marcam a barreira",
    { annotation: requirement(CA1) },
    async ({ request }, testInfo) => {
      const { id } = await createAudit(request, fixtureUrl("painel"));
      const audit = await waitForAuditEnd(request, id);
      const pages = await listPages(request, id);
      await attachObserved(testInfo, { audit, pages });

      expect(audit).toMatchObject({ status: "completed", login_wall_pages: 1, error: null });
      expect(pages).toEqual([
        expect.objectContaining({
          url: fixtureUrl("painel"),
          final_url: fixtureUrl("entrar.html"),
          status: "done",
          login_wall: true,
        }),
      ]);
    },
  );

  test(
    "RF-RA028 CA2: página que responde 401 marca a barreira, com a mensagem de login",
    { annotation: requirement(CA2) },
    async ({ request }, testInfo) => {
      const { id } = await createAudit(request, fixtureUrl("restrito"));
      const audit = await waitForAuditEnd(request, id);
      const pages = await listPages(request, id);
      await attachObserved(testInfo, { audit, pages });

      expect(audit).toMatchObject({
        status: "failed",
        login_wall_pages: 1,
        error: { code: "http_error", http_status: 401 },
      });
      expect(audit.error?.message).toContain(messages.loginWallStart(401));
      expect(pages).toEqual([expect.objectContaining({ status: "failed", http_status: 401, login_wall: true })]);
    },
  );

  test(
    "RF-RA028 CA3: limpa.html não tem barreira",
    { annotation: requirement(CA3) },
    async ({ request }, testInfo) => {
      const { id } = await createAudit(request, fixtureUrl("limpa.html"));
      const audit = await waitForAuditEnd(request, id);
      const pages = await listPages(request, id);
      await attachObserved(testInfo, { audit, pages });

      expect(audit).toMatchObject({ status: "completed", login_wall_pages: 0 });
      expect(pages).toEqual([expect.objectContaining({ status: "done", login_wall: false })]);
    },
  );

  test(
    "RF-RA028: a tela de entrar aberta direto, sem redirecionamento, não é barreira",
    { annotation: requirement(PRECISION) },
    async ({ request }, testInfo) => {
      const { id } = await createAudit(request, fixtureUrl("entrar.html"));
      const audit = await waitForAuditEnd(request, id);
      const pages = await listPages(request, id);
      await attachObserved(testInfo, { audit, pages });

      expect(audit).toMatchObject({ status: "completed", login_wall_pages: 0 });
      expect(pages).toEqual([expect.objectContaining({ status: "done", login_wall: false })]);
    },
  );

  test(
    "RF-RA028 CA1 (tela): /painel mostra o aviso no resumo e no relatório da página, com ícone e texto",
    { annotation: requirement(CA1) },
    async ({ browser, request }, testInfo) => {
      const clientIp = newClientIp();
      const { id } = await createAudit(request, fixtureUrl("painel"), { clientIp });
      await waitForAuditEnd(request, id);
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Relatório de fixtures" })).toBeVisible();
      const onSummary = await loginWallNotice(page).isVisible();
      const summaryIcon = await loginWallNotice(page).locator("svg").count();
      const summaryAxe = await axeViolations(page);

      await page.getByRole("link", { name: "Ver páginas e problemas" }).click();
      await page.getByRole("list", { name: "Páginas da auditoria" }).getByRole("link").first().click();
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
      const onPage = await loginWallNotice(page).isVisible();
      const pageAxe = await axeViolations(page);
      await attachObserved(testInfo, { id, onSummary, summaryIcon, summaryAxe, onPage, pageAxe, url: page.url() });

      expect(onSummary).toBe(true);
      expect(summaryIcon).toBe(1);
      expect(onPage).toBe(true);
      expect(summaryAxe).toEqual([]);
      expect(pageAxe).toEqual([]);
      await context.close();
    },
  );

  test(
    "RF-RA028 CA2 (tela): /restrito (401) mostra o aviso de login adaptado na tela de falha",
    { annotation: requirement(CA2) },
    async ({ browser, request }, testInfo) => {
      const clientIp = newClientIp();
      const { id } = await createAudit(request, fixtureUrl("restrito"), { clientIp });
      const audit = await waitForAuditEnd(request, id);
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "A auditoria de fixtures parou" })).toBeVisible();
      const shown = page.getByText(messages.loginWallStart(401), { exact: false });
      const visible = await shown.first().isVisible();
      const axe = await axeViolations(page);
      await attachObserved(testInfo, { audit, visible, text: await shown.first().textContent(), axe });

      expect(visible).toBe(true);
      expect(axe).toEqual([]);
      await context.close();
    },
  );

  test(
    "RF-RA028 CA3 e RF-RA017 (tela): limpa.html sem aviso; a aba Aprovados lista image-alt com o selo e sem prometer acessibilidade",
    { annotation: [requirement(CA3), requirement(PASSED_CA1), requirement(PASSED_CA2)] },
    async ({ browser, request }, testInfo) => {
      const clientIp = newClientIp();
      const { id } = await createAudit(request, fixtureUrl("limpa.html"), { clientIp });
      await waitForAuditEnd(request, id);
      const [pageInfo] = await listPages(request, id);
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}`);
      await expect(page.getByText(screenTexts.disclaimer)).toBeVisible();
      const summaryNotices = await page.getByText(/pede login/).count();

      await page.goto(`/auditorias/${id}/paginas/${pageInfo!.id}?aba=aprovados`);
      const rules = page.getByRole("list", { name: "Regras aprovadas" }).getByRole("listitem");
      await expect(rules.first()).toBeVisible();
      const pageNotices = await page.getByText(/pede login/).count();
      const imageAlt = rules.filter({ hasText: "image-alt" });
      const imageAltText = await imageAlt.textContent();
      const mainText = (await page.getByRole("main").textContent()) ?? "";
      const axe = await axeViolations(page);
      await attachObserved(testInfo, { id, summaryNotices, pageNotices, imageAltText, rules: await rules.count(), axe });

      expect(summaryNotices).toBe(0);
      expect(pageNotices).toBe(0);
      await expect(imageAlt).toHaveCount(1);
      expect(imageAltText).toContain("Aprovado");
      expect(mainText).not.toMatch(/acessível|conforme/i);
      expect(axe).toEqual([]);
      await context.close();
    },
  );
});
