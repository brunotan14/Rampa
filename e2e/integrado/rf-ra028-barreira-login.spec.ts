import { expect, test } from "@playwright/test";
import { createAudit, fixtureUrl, listPages, waitForAuditEnd } from "./support/api.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";
import { messages } from "./support/messages.js";

// RF-RA028: aviso de barreira de login, pela API. A tela (o aviso com ícone e texto) vem na
// `feat/tela-relatorio`; aqui ficam os campos de que ela depende: `login_wall` da página e
// `login_wall_pages` do resumo. O CA4 (medição) é provado nos testes do backend
// (`Rampa.Audits.LoginWallDailyTest`): a consulta é pela release, sem rota na API.

const CA1 =
  "RF-RA028 CA1: Dado uma URL que redireciona para uma página com campo de senha, quando a auditoria termina, então o relatório mostra o aviso de barreira de login na página e no resumo.";
const CA2 = "RF-RA028 CA2: Dado uma página que responde 401, quando a auditoria termina, então o aviso aparece.";
const CA3 = "RF-RA028 CA3: Dado a `limpa.html` (sem login), quando a auditoria termina, então não há aviso.";
const PRECISION =
  "RF-RA028 (decisão do §15): campo de senha sem redirecionamento (formulário de login numa página comum) não é barreira: precisão antes de cobertura.";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

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
});
