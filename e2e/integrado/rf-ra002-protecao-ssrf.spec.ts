import { expect, test } from "@playwright/test";
import {
  apiError,
  createAudit,
  fixtureUrl,
  listFindings,
  postAudit,
  scanDirect,
  waitForAuditEnd,
} from "./support/api.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";
import { messages } from "./support/messages.js";

// RF-RA002: proteção contra SSRF. Os limites de taxa ficam em `rf-ra002-limites.spec.ts`.
// Dois critérios são provados fora do Playwright, pelo `infra/test/run-e2e.sh`, antes dos
// specs: a release de produção não sobe com a `SSRF_ALLOWLIST` (`check-allowlist-prod.sh`) e
// o scanner não alcança o banco (`check-network-isolation.sh`).

const CA1 =
  'RF-RA002 CA1: Dado `http://localhost:4000`, `http://169.254.169.254/` ou um domínio que resolve para `10.0.0.5`, quando inicio a auditoria, então ela é recusada com a mensagem "Este endereço não pode ser auditado".';
const CA2 =
  "RF-RA002 CA2: Dado uma página pública que redireciona para `http://127.0.0.1/`, quando ela é varrida, então o redirecionamento é bloqueado e a página é marcada com erro de acesso.";
const CA3 =
  'RF-RA002 CA3: Dado uma página pública com `<img src="http://192.168.0.1/x.png">`, quando ela é varrida, então a requisição da imagem é bloqueada e a varredura continua.';
const CA6 =
  "RF-RA002 CA6: Dado o Compose de teste com `SSRF_ALLOWLIST=fixtures`, quando audito `http://fixtures/limpa.html`, então a auditoria roda, e `http://postgres/` continua bloqueado.";

const BLOCKED_ADDRESSES = [
  { url: "http://localhost:4000", why: "localhost" },
  { url: "http://169.254.169.254/", why: "link-local (metadados de nuvem)" },
  // `interno.rampa.test` resolve para 10.0.0.5 no app e no scanner (`extra_hosts` do Compose).
  { url: "http://interno.rampa.test/", why: "domínio que resolve para 10.0.0.5" },
];

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test.describe("RF-RA002: proteção contra SSRF", () => {
  for (const { url, why } of BLOCKED_ADDRESSES) {
    test(
      `RF-RA002 CA1: ${url} (${why}) é recusado com "Este endereço não pode ser auditado"`,
      { annotation: requirement(CA1) },
      async ({ request }, testInfo) => {
        const refusal = await postAudit(request, url);
        await attachObserved(testInfo, { url, status: refusal.status, body: refusal.body });

        expect(refusal.status, JSON.stringify(refusal.body)).toBe(422);
        const error = apiError(refusal);
        expect(error.code).toBe("blocked_address");
        expect(error.message.startsWith(messages.blockedAddressStart), error.message).toBe(true);
      },
    );
  }

  test(
    "RF-RA002 CA2: página que redireciona para 127.0.0.1 termina com erro de acesso blocked_address",
    { annotation: requirement(CA2) },
    async ({ request }, testInfo) => {
      // `ssrf/redireciona-loopback` responde 302 para `http://127.0.0.1/`
      // (`infra/test/fixtures-nginx.conf`). No M1 a auditoria tem uma página: o erro dela é o
      // erro da auditoria, e `pages_failed` conta a página marcada.
      const { id } = await createAudit(request, fixtureUrl("ssrf/redireciona-loopback"));
      const audit = await waitForAuditEnd(request, id);
      await attachObserved(testInfo, { audit });

      expect(audit).toMatchObject({
        status: "failed",
        pages_found: 1,
        pages_scanned: 0,
        pages_failed: 1,
        error: { code: "blocked_address" },
      });
      expect(audit.error?.message.startsWith(messages.blockedAddressStart), audit.error?.message).toBe(true);
    },
  );

  test(
    "RF-RA002 CA3: a imagem em 192.168.0.1 é bloqueada pelo scanner",
    { annotation: requirement(CA3) },
    async ({ request }, testInfo) => {
      // `blocked_requests` não é gravado no banco: só o scanner direto o mostra.
      const url = fixtureUrl("ssrf/img-ip-privado.html");
      const scan = await scanDirect(request, url);
      await attachObserved(testInfo, {
        url,
        status: scan.status,
        final_url: scan.body.final_url,
        http_status: scan.body.http_status,
        blocked_requests: scan.body.blocked_requests,
        error: scan.body.error,
      });

      expect(scan.status, JSON.stringify(scan.body.error ?? null)).toBe(200);
      expect(scan.body).toMatchObject({ final_url: url, http_status: 200 });
      expect(scan.body.blocked_requests).toBeGreaterThanOrEqual(1);
    },
  );

  test(
    "RF-RA002 CA3: com a imagem bloqueada, a varredura continua e aponta o botão sem nome",
    { annotation: requirement(CA3) },
    async ({ request }, testInfo) => {
      // O botão sem nome da fixture só é apontado se a página foi analisada depois do bloqueio.
      const { id } = await createAudit(request, fixtureUrl("ssrf/img-ip-privado.html"));
      const audit = await waitForAuditEnd(request, id);
      const findings = await listFindings(request, id);
      await attachObserved(testInfo, { audit, findings });

      expect(audit).toMatchObject({ status: "completed", pages_scanned: 1, pages_failed: 0, error: null });
      expect(findings).toContainEqual(
        expect.objectContaining({
          source: "axe",
          rule_id: "button-name",
          severity: "critical",
          needs_review: false,
          wcag_criteria: expect.arrayContaining(["4.1.2"]),
        }),
      );
    },
  );

  test(
    "RF-RA002 CA6: com SSRF_ALLOWLIST=fixtures, http://fixtures/limpa.html é auditado",
    { annotation: requirement(CA6) },
    async ({ request }, testInfo) => {
      const url = fixtureUrl("limpa.html");
      const { id } = await createAudit(request, url);
      const audit = await waitForAuditEnd(request, id);
      await attachObserved(testInfo, { audit });

      expect(audit).toMatchObject({ status: "completed", start_url: url, pages_scanned: 1, error: null });
    },
  );

  test(
    "RF-RA002 CA6: com SSRF_ALLOWLIST=fixtures, http://postgres/ continua bloqueado",
    { annotation: requirement(CA6) },
    async ({ request }, testInfo) => {
      const refusal = await postAudit(request, "http://postgres/");
      await attachObserved(testInfo, { status: refusal.status, body: refusal.body });

      expect(refusal.status, JSON.stringify(refusal.body)).toBe(422);
      const error = apiError(refusal);
      expect(error.code).toBe("blocked_address");
      expect(error.message.startsWith(messages.blockedAddressStart), error.message).toBe(true);
    },
  );
});
