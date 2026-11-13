import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAudit, fixtureHits, fixtureUrl, getAudit, listFindings, listPages, waitForAuditEnd } from "./support/api.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";
import { messages } from "./support/messages.js";

// RF-RA029: falha de acesso à página, pela API. O botão "Auditar de novo" e a mensagem na tela
// vêm na `feat/tela-relatorio`; aqui ficam a mensagem por status (pronta na API), o
// `http_status` e as novas tentativas. As rotas `/instavel/<uuid>` e `/sempre-503/<uuid>` do
// site de fixtures contam os pedidos (`fixtureHits`); o UUID separa os testes. No Compose de
// teste a espera entre as tentativas é de 1 s (`config/e2e.exs`).

const CA1 =
  "RF-RA029 CA1: Dado uma URL que responde 404, quando a auditoria termina, então vejo \"A página não foi encontrada (HTTP 404)\" e o botão \"Auditar de novo\".";
const CA2 =
  "RF-RA029 CA2: Dado uma URL que responde 503 nas duas tentativas, quando a auditoria termina, então vejo a mensagem de site instável, e o backend fez uma nova tentativa antes de desistir.";
const CA3 =
  "RF-RA029 CA3: Dado uma URL que responde 503 e depois 200, quando a auditoria termina, então ela é concluída com os achados.";
const CA4 =
  "RF-RA029 CA4: Dado uma auditoria com falha, quando clico em \"Auditar de novo\", então uma nova auditoria da mesma URL começa e a antiga continua acessível pelo link dela.";

// Duas tentativas com a espera curta: cabem com folga em 90 s.
const RETRY_TIMEOUT_MS = 90_000;

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test.describe("RF-RA029: falha de acesso à página", () => {
  test(
    "RF-RA029 CA1: 404 falha na hora, com o status e a mensagem de página não encontrada",
    { annotation: requirement(CA1) },
    async ({ request }, testInfo) => {
      const { id } = await createAudit(request, fixtureUrl("nao-existe.html"));
      const audit = await waitForAuditEnd(request, id);
      const pages = await listPages(request, id);
      await attachObserved(testInfo, { audit, pages });

      expect(audit).toMatchObject({
        status: "failed",
        pages_failed: 1,
        login_wall_pages: 0,
        error: { code: "http_error", http_status: 404, message: messages.notFound(404) },
      });
      expect(pages).toEqual([
        expect.objectContaining({
          status: "failed",
          http_status: 404,
          login_wall: null,
          error: { code: "http_error", http_status: 404, message: messages.notFound(404) },
        }),
      ]);
    },
  );

  test(
    "RF-RA029 CA2: 503 nas duas tentativas falha com a mensagem de site instável, depois de uma nova tentativa",
    { annotation: requirement(CA2) },
    async ({ request }, testInfo) => {
      const path = `sempre-503/${randomUUID()}`;
      const { id } = await createAudit(request, fixtureUrl(path));
      const audit = await waitForAuditEnd(request, id, { timeoutMs: RETRY_TIMEOUT_MS });
      const hits = await fixtureHits(request, path);
      await attachObserved(testInfo, { audit, hits });

      expect(audit).toMatchObject({
        status: "failed",
        error: { code: "http_error", http_status: 503, message: messages.unstable(503) },
      });
      // Primeira tentativa e a nova tentativa: o documento foi pedido duas vezes.
      expect(hits).toBe(2);
    },
  );

  test(
    "RF-RA029 CA3: 503 e depois 200 conclui a auditoria com os achados",
    { annotation: requirement(CA3) },
    async ({ request }, testInfo) => {
      const path = `instavel/${randomUUID()}`;
      const { id } = await createAudit(request, fixtureUrl(path));
      const audit = await waitForAuditEnd(request, id, { timeoutMs: RETRY_TIMEOUT_MS });
      const findings = await listFindings(request, id);
      const hits = await fixtureHits(request, path);
      await attachObserved(testInfo, { audit, findings, hits });

      expect(audit).toMatchObject({ status: "completed", pages_scanned: 1, pages_failed: 0, error: null });
      // A segunda resposta é a `img-sem-alt.html`.
      expect(findings).toContainEqual(expect.objectContaining({ rule_id: "image-alt", severity: "critical" }));
      expect(hits).toBe(2);
    },
  );

  test(
    "RF-RA029 CA4 (API): auditar de novo cria outra auditoria da mesma URL e a antiga não muda",
    { annotation: requirement(CA4) },
    async ({ request }, testInfo) => {
      const url = fixtureUrl("nao-existe.html");
      const first = await createAudit(request, url, { idempotencyKey: randomUUID() });
      const failed = await waitForAuditEnd(request, first.id);

      // O que o botão faz: POST com a `start_url` da auditoria e uma chave nova.
      const again = await createAudit(request, failed.start_url, {
        clientIp: first.clientIp,
        idempotencyKey: randomUUID(),
      });
      const retried = await waitForAuditEnd(request, again.id);
      const old = await getAudit(request, first.id);
      await attachObserved(testInfo, { failed, retried, old });

      expect(again.id).not.toBe(first.id);
      expect(retried).toMatchObject({ start_url: url, status: "failed" });
      expect(old).toEqual(failed);
    },
  );
});
