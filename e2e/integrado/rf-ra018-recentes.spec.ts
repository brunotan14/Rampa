import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAudit, fixtureUrl, waitForAuditEnd } from "./support/api.js";
import { openBrowserPage } from "./support/browser.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";

// RF-RA018 CA2.4 contra o backend real: a lista de recentes da tela inicial tira o item cuja
// auditoria responde "não encontrada" (404 `audit_not_found` da API) e mantém a que existe.
// O item que sai é um UUID que nunca existiu. Que uma auditoria apagada pela retenção responde
// igual à inexistente está provado no CA2.3 (testes do controller e do canal, no backend). Apagar
// de verdade a partir daqui exige uma rota de teste ou acesso do runner ao banco: ficou como
// pendência. Os itens são gravados direto no `localStorage` (estado de partida do caso).

const CA2_4 =
  "RF-RA018 CA2.4: Given uma auditoria da minha lista que foi apagada ou não existe, When abro a tela inicial, Then ela sai da lista.";

const RECENT_KEY = "rampa.recentAudits.v1";
const TITLE = "Auditorias recentes";
const LIST = "Auditorias recentes deste navegador";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test.describe("RF-RA018: auditorias recentes com o backend real", () => {
  test(
    "RF-RA018 CA2.4: a auditoria que não existe sai da lista e a que existe continua",
    { annotation: requirement(CA2_4) },
    async ({ browser, request }, testInfo) => {
      const { id, clientIp } = await createAudit(request, fixtureUrl("limpa.html"));
      const audit = await waitForAuditEnd(request, id);
      const missingId = randomUUID();
      const missing = await request.get(`/api/audits/${missingId}`);
      const missingBody: unknown = await missing.json();

      const { context, page } = await openBrowserPage(browser, clientIp ?? undefined);
      try {
        // A inexistente foi aberta por último: fica no topo da lista guardada.
        const stored = {
          version: 1,
          items: [
            { id: missingId, startUrl: fixtureUrl("img-sem-alt.html"), createdAt: audit.inserted_at, status: "completed", lastOpenedAt: new Date().toISOString() },
            { id, startUrl: audit.start_url, createdAt: audit.inserted_at, status: "queued", lastOpenedAt: new Date(Date.now() - 60_000).toISOString() },
          ],
        };
        await page.goto("/");
        await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [RECENT_KEY, JSON.stringify(stored)] as const);

        const gone = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/audits/${missingId}`);
        await page.reload();
        const goneResponse = await gone;
        const goneBody: unknown = await goneResponse.json();

        const links = page.getByRole("region", { name: TITLE }).getByRole("list", { name: LIST }).getByRole("link");
        await expect(links).toHaveCount(1);
        const remaining = {
          text: await links.first().textContent(),
          href: await links.first().getAttribute("href"),
        };
        const storedAfter = await page.evaluate((key) => window.localStorage.getItem(key), RECENT_KEY);
        await attachObserved(testInfo, {
          audit: { id, status: audit.status, start_url: audit.start_url, inserted_at: audit.inserted_at },
          missingId,
          apiResponse: { status: missing.status(), body: missingBody },
          browserResponse: { status: goneResponse.status(), body: goneBody },
          remaining,
          storedAfter: storedAfter === null ? null : (JSON.parse(storedAfter) as unknown),
        });

        expect(missing.status()).toBe(404);
        expect(missingBody).toMatchObject({ error: { code: "audit_not_found" } });
        expect(goneResponse.status()).toBe(404);
        expect(audit.status).toBe("completed");
        await expect(links.first()).toHaveAttribute("href", `/auditorias/${id}`);
        // O status guardado era "Na fila": o item mostra o atual, vindo da API.
        await expect(links.first()).toHaveAccessibleName(/^fixtures\/limpa\.html ?, Criada .+ ?, Concluída$/);
        expect(storedAfter).not.toContain(missingId);
        expect(storedAfter).toContain(id);
      } finally {
        await context.close();
      }
    },
  );
});
