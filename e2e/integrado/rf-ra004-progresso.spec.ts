import { expect, test } from "@playwright/test";
import { fixtureUrl, getAudit, newClientIp } from "./support/api.js";
import { env } from "./support/env.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";

// RF-RA004: progresso em tempo real, com o app, o canal `audit:<id>` e o scanner reais. No M2 a
// auditoria tem uma página só (o limite 1–25 é do M5): o contador vai de 0 a 1 sem recarregar
// e a conclusão é anunciada uma vez. Os casos de 5 páginas e da queda de conexão ficam no
// `make e2e` (`tests/tela-progresso.spec.ts`), com o canal simulado.

const CA1 =
  "RF-RA004 CA1: Dado uma auditoria de 5 páginas em andamento, quando cada página termina, então o contador de analisadas aumenta sem recarregar a tela.";
const CA2 =
  "RF-RA004 CA2: Dado que estou com leitor de tela, quando a auditoria termina, então ouço \"Auditoria concluída: N problemas em M páginas\" uma única vez.";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test(
  "RF-RA004 CA1 e CA2: o contador sobe sem recarregar e a conclusão é anunciada uma única vez",
  { annotation: [requirement(CA1), requirement(CA2)] },
  async ({ browser, request }, testInfo) => {
    const context = await browser.newContext({
      baseURL: env.webUrl,
      locale: "pt-BR",
      reducedMotion: "reduce",
      extraHTTPHeaders: { "X-Forwarded-For": newClientIp() },
    });
    const page = await context.newPage();
    let navigations = 0;

    await page.goto("/");
    await page.getByRole("textbox", { name: "Endereço do site" }).fill(fixtureUrl("img-sem-alt.html"));
    await page.getByRole("button", { name: "Auditar" }).click();
    await page.waitForURL(/\/auditorias\/[0-9a-f-]{36}$/);
    page.on("framenavigated", () => navigations++);

    // Cada texto novo da única região viva da tela.
    await page.evaluate(() => {
      const said: string[] = [];
      (window as unknown as { __said: string[] }).__said = said;
      const region = document.querySelector('[role="status"][aria-live="polite"]');
      if (!region) throw new Error("sem região viva");
      if (region.textContent) said.push(region.textContent);
      new MutationObserver(() => {
        const text = region.textContent ?? "";
        if (text !== "" && said.at(-1) !== text) said.push(text);
      }).observe(region, { childList: true, characterData: true, subtree: true });
    });

    const scanned = page.locator('xpath=//dt[normalize-space(.)="Analisadas"]/following-sibling::dd[1]');
    await expect(page.getByRole("button", { name: "Ver relatório" })).toBeVisible({ timeout: 60_000 });
    // Depois do fim: reconexões e eventos repetidos não podem repetir o anúncio.
    await page.waitForTimeout(2_000);

    const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    const audit = await getAudit(request, id);
    const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
    await attachObserved(testInfo, { audit, said, navigations, scanned: await scanned.textContent() });

    expect(audit.status).toBe("completed");
    expect(navigations).toBe(0);
    await expect(scanned).toHaveText(String(audit.pages_scanned));
    const problems = Object.values(audit.totals_by_severity).reduce((sum, n) => sum + n, 0);
    const pages = audit.pages_scanned;
    expect(said).toEqual([
      `Auditoria concluída: ${problems} ${problems === 1 ? "problema" : "problemas"} em ${pages} ${pages === 1 ? "página" : "páginas"}.`,
    ]);
    await context.close();
  },
);
