import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { axeViolations } from "../tests/a11y.js";
import {
  createAudit,
  fixtureHits,
  fixtureUrl,
  getAudit,
  listFindings,
  listPages,
  newClientIp,
  waitForAuditEnd,
} from "./support/api.js";
import { openBrowserPage } from "./support/browser.js";
import { limits } from "./support/env.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";
import { messages, screenTexts } from "./support/messages.js";

// RF-RA029: falha de acesso à página, pela API (a mensagem por status, pronta na API, o
// `http_status` e as novas tentativas) e pela tela (`feat/tela-relatorio`): a mensagem e o
// botão "Auditar de novo" na tela de falha, a nova auditoria que ele cria e o limite de uso. As
// rotas `/instavel/<uuid>`, `/sempre-503/<uuid>` e `/proibido/<uuid>` do site de fixtures contam
// os pedidos (`fixtureHits`); o UUID separa os testes. No Compose de teste a espera entre as
// tentativas é de 1 s (`config/e2e.exs`).

const CA1 =
  "RF-RA029 CA1: Dado uma URL que responde 404, quando a auditoria termina, então vejo \"A página não foi encontrada (HTTP 404)\" e o botão \"Auditar de novo\".";
const CA2 =
  "RF-RA029 CA2: Dado uma URL que responde 503 nas duas tentativas, quando a auditoria termina, então vejo a mensagem de site instável, e o backend fez uma nova tentativa antes de desistir.";
const CA3 =
  "RF-RA029 CA3: Dado uma URL que responde 503 e depois 200, quando a auditoria termina, então ela é concluída com os achados.";
const CA4 =
  "RF-RA029 CA4: Dado uma auditoria com falha, quando clico em \"Auditar de novo\", então uma nova auditoria da mesma URL começa e a antiga continua acessível pelo link dela.";

const CA5 =
  "RF-RA029 CA5: Dado que atingi o limite de uso, quando clico em \"Auditar de novo\", então vejo a mensagem com o horário de liberação.";

// O 403 não tem critério próprio: o caso cita as regras do RF-RA029 e do RF-RA028 que o descrevem.
const FORBIDDEN_MESSAGE =
  "RF-RA029 (mensagem por tipo de falha): 403: \"O site recusou o acesso (HTTP 403). Ele pode exigir login ou bloquear acessos automáticos.\" (não marca barreira de login: costuma ser bloqueio de robô)";
const FORBIDDEN_DEFINITIVE =
  "RF-RA029 (novas tentativas automáticas): 400, 401, 403, 404, 410, os demais 4xx, o 500 e o `http_error` sem status continuam definitivos.";
const FORBIDDEN_NOT_LOGIN_WALL =
  "RF-RA028: O 403 sozinho também não: num site público costuma ser bloqueio de robô (WAF); `login_wall` fica `NULL` e a mensagem do erro cita as duas hipóteses (RF-RA029).";

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
    "RF-RA029 (403): falha definitiva na primeira tentativa, com a mensagem do 403 e sem barreira de login",
    { annotation: [requirement(FORBIDDEN_MESSAGE), requirement(FORBIDDEN_DEFINITIVE), requirement(FORBIDDEN_NOT_LOGIN_WALL)] },
    async ({ request }, testInfo) => {
      const path = `proibido/${randomUUID()}`;
      const { id } = await createAudit(request, fixtureUrl(path));
      const audit = await waitForAuditEnd(request, id);
      const pages = await listPages(request, id);
      const hits = await fixtureHits(request, path);
      await attachObserved(testInfo, { audit, pages, hits });

      expect(audit).toMatchObject({
        status: "failed",
        pages_failed: 1,
        login_wall_pages: 0,
        error: { code: "http_error", http_status: 403, message: messages.forbidden(403) },
      });
      expect(pages).toEqual([
        expect.objectContaining({
          status: "failed",
          http_status: 403,
          login_wall: null,
          error: { code: "http_error", http_status: 403, message: messages.forbidden(403) },
        }),
      ]);
      // Hoje cada tentativa da varredura pede o documento uma vez: um pedido com a auditoria já
      // encerrada é uma tentativa só. O caso do 503 (CA2) prova que a nova tentativa faria 2.
      expect(hits).toBe(1);
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

  test(
    "RF-RA029 CA1 (tela): 404 mostra \"A página não foi encontrada (HTTP 404)\" e o botão \"Auditar de novo\"",
    { annotation: requirement(CA1) },
    async ({ browser, request }, testInfo) => {
      const clientIp = newClientIp();
      const { id } = await createAudit(request, fixtureUrl("nao-existe.html"), { clientIp });
      const audit = await waitForAuditEnd(request, id);
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "A auditoria de fixtures parou" })).toBeVisible();
      const message = page.getByText(messages.notFound(404), { exact: false }).first();
      const button = page.getByRole("button", { name: screenTexts.auditAgain });
      const observed = { visible: await message.isVisible(), button: await button.isVisible(), axe: await axeViolations(page) };
      await attachObserved(testInfo, { audit, ...observed });

      expect(observed.visible).toBe(true);
      expect(observed.button).toBe(true);
      expect(observed.axe).toEqual([]);
      await context.close();
    },
  );

  test(
    "RF-RA029 (403, tela): a mensagem do 403 e o botão \"Auditar de novo\", sem o aviso de barreira de login",
    { annotation: [requirement(FORBIDDEN_MESSAGE), requirement(FORBIDDEN_NOT_LOGIN_WALL)] },
    async ({ browser, request }, testInfo) => {
      const clientIp = newClientIp();
      const { id } = await createAudit(request, fixtureUrl(`proibido/${randomUUID()}`), { clientIp });
      const audit = await waitForAuditEnd(request, id);
      const { context, page } = await openBrowserPage(browser, clientIp);
      try {
        await page.goto(`/auditorias/${id}`);
        await expect(page.getByRole("heading", { level: 1, name: "A auditoria de fixtures parou" })).toBeVisible();
        const message = page.getByText(messages.forbidden(403), { exact: false }).first();
        const button = page.getByRole("button", { name: screenTexts.auditAgain });
        const observed = {
          visible: await message.isVisible(),
          button: await button.isVisible(),
          loginWallNotices: await page.getByText(/pede login/).count(),
          axe: await axeViolations(page),
        };
        await attachObserved(testInfo, { audit, ...observed });

        expect(observed.visible).toBe(true);
        expect(observed.button).toBe(true);
        expect(observed.loginWallNotices).toBe(0);
        expect(observed.axe).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );

  test(
    "RF-RA029 CA4 (tela): \"Auditar de novo\" começa outra auditoria da mesma URL e a antiga continua no link dela",
    { annotation: requirement(CA4) },
    async ({ browser, request }, testInfo) => {
      const clientIp = newClientIp();
      const url = fixtureUrl("nao-existe.html");
      const { id } = await createAudit(request, url, { clientIp });
      const failed = await waitForAuditEnd(request, id);
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}`);
      await page.getByRole("button", { name: screenTexts.auditAgain }).click();
      await page.waitForURL((current) => /\/auditorias\/[0-9a-f-]{36}$/.test(current.pathname) && !current.pathname.endsWith(id));
      const newId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveText(/^(Auditando fixtures|A auditoria de fixtures parou)$/);
      const retried = await waitForAuditEnd(request, newId);
      const old = await getAudit(request, id);

      // O link antigo continua mostrando a falha antiga.
      await page.goto(`/auditorias/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "A auditoria de fixtures parou" })).toBeVisible();
      const oldMessage = await page.getByText(messages.notFound(404), { exact: false }).first().isVisible();
      await attachObserved(testInfo, { id, newId, failed, retried, old, oldMessage, h1Focused: await h1.evaluate((el) => el === document.activeElement) });

      expect(newId).not.toBe(id);
      expect(retried).toMatchObject({ start_url: url, page_limit: failed.page_limit });
      expect(old).toEqual(failed);
      expect(oldMessage).toBe(true);
      await context.close();
    },
  );

  test(
    "RF-RA029 CA5 (tela): no limite de uso, \"Auditar de novo\" mostra o horário de liberação e não cria auditoria",
    { annotation: requirement(CA5) },
    async ({ browser, request }, testInfo) => {
      // O mesmo IP cria a auditoria com falha e mais quatro: é o limite por hora.
      const clientIp = newClientIp();
      const { id } = await createAudit(request, fixtureUrl("nao-existe.html"), { clientIp });
      await waitForAuditEnd(request, id);
      for (let created = 1; created < limits.perIpPerHour; created++) {
        await createAudit(request, fixtureUrl("limpa.html"), { clientIp });
      }
      const { context, page } = await openBrowserPage(browser, clientIp);
      await page.goto(`/auditorias/${id}`);
      const button = page.getByRole("button", { name: screenTexts.auditAgain });
      const answer = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/audits" && r.request().method() === "POST");
      await button.click();
      const response = await answer;
      const body = (await response.json()) as { error: { code: string; retry_after: string } };
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      const text = ((await alert.textContent()) ?? "").trim();
      // O horário da tela é o `retry_after` no fuso do navegador.
      const expectedTime = await page.evaluate(
        (iso) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)),
        body.error.retry_after,
      );
      await attachObserved(testInfo, { status: response.status(), body, text, expectedTime, url: page.url() });

      expect(response.status()).toBe(429);
      expect(body.error.code).toBe("rate_limited");
      expect(text).toMatch(screenTexts.rateLimited);
      expect(text.match(screenTexts.rateLimited)?.[2]).toBe(expectedTime);
      expect(new URL(page.url()).pathname).toBe(`/auditorias/${id}`);
      await expect(button).toBeFocused();
      expect(await axeViolations(page)).toEqual([]);
      await context.close();
    },
  );
});
