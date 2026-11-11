import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiError, createAudit, fixtureUrl, getAudit, newClientIp, postAudit } from "./support/api.js";
import { limits } from "./support/env.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";
import { messages } from "./support/messages.js";

// RF-RA001: iniciar auditoria por URL. No M1 não há tela de início: os critérios são
// verificados pela API, que devolve a mensagem pronta para exibir (PRD §9). A tela de
// progresso e a mensagem no formulário entram no M2.

const CA1 =
  "RF-RA001 CA1: Dado uma URL pública válida, quando inicio a auditoria, então recebo o identificador e sou levado à tela de progresso.";
const CA2 =
  "RF-RA001 CA2: Dado `ftp://exemplo.com` ou `javascript:alert(1)`, quando inicio a auditoria, então vejo uma mensagem explicando que só endereços web são aceitos, e nenhuma auditoria é criada.";
const CA3 =
  "RF-RA001 CA3: Dado `exemplo.com` sem esquema, quando inicio a auditoria, então a auditoria é criada para `https://exemplo.com/`.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NON_WEB_URLS = ["ftp://exemplo.com", "javascript:alert(1)"];

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test.describe("RF-RA001: iniciar auditoria por URL", () => {
  test(
    "RF-RA001 CA1: URL pública válida recebe 202 com o id, e a auditoria existe no GET",
    { annotation: requirement(CA1) },
    async ({ request }, testInfo) => {
      const url = fixtureUrl("img-sem-alt.html");

      const created = await postAudit(request, url);
      const id = (created.body as { id?: string }).id ?? "";
      const audit = created.status === 202 ? await getAudit(request, id) : null;
      await attachObserved(testInfo, { post: { status: created.status, body: created.body }, audit });

      expect(created.status, JSON.stringify(created.body)).toBe(202);
      expect(id).toMatch(UUID);
      expect(audit).toMatchObject({ id, start_url: url, page_limit: 1 });
      expect(["queued", "running", "completed"]).toContain(audit?.status);
    },
  );

  // A tela de progresso é do M2 (RF-RA004); no M1 o frontend não tem o formulário de início.
  test.fixme(
    "RF-RA001 CA1: depois de iniciar, a pessoa é levada à tela de progresso",
    { annotation: requirement(CA1) },
    async () => {},
  );

  for (const url of NON_WEB_URLS) {
    test(
      `RF-RA001 CA2: ${url} é recusado com a mensagem de só endereços web, sem criar auditoria`,
      { annotation: requirement(CA2) },
      async ({ request }, testInfo) => {
        // Prova de que nada foi criado: as recusas usam o mesmo IP e a mesma chave do pedido
        // válido do fim. Se alguma tivesse criado auditoria, as cinco ocupariam o limite por
        // hora (429) e a chave estaria presa a outra URL (422 idempotency_key_reused).
        const clientIp = newClientIp();
        const idempotencyKey = `rf-ra001-ca2-${randomUUID()}`;

        const refusals = [];
        for (let attempt = 0; attempt < limits.perIpPerHour; attempt++) {
          refusals.push(await postAudit(request, url, { clientIp, idempotencyKey }));
        }
        const validUrl = fixtureUrl("limpa.html");
        const afterRefusals = await postAudit(request, validUrl, { clientIp, idempotencyKey });
        await attachObserved(testInfo, {
          refusals: refusals.map(({ status, body }) => ({ status, body })),
          afterRefusals: { url: validUrl, status: afterRefusals.status, body: afterRefusals.body },
        });

        for (const refusal of refusals) {
          expect(refusal.status, JSON.stringify(refusal.body)).toBe(422);
          expect(apiError(refusal)).toEqual({ code: "unsupported_scheme", message: messages.unsupportedScheme });
        }
        expect(afterRefusals.status, JSON.stringify(afterRefusals.body)).toBe(202);
        const audit = await getAudit(request, (afterRefusals.body as { id: string }).id);
        expect(audit.start_url).toBe(validUrl);
      },
    );
  }

  test(
    "RF-RA001 CA3: endereço sem esquema é auditado como https:// com caminho /",
    { annotation: requirement(CA3) },
    async ({ request }, testInfo) => {
      // `exemplo.com` não resolve dentro do Compose (redes internas: 422 unresolvable). O host
      // `fixtures` passa pela allowlist e segue a mesma normalização. A varredura depois falha
      // na 443, que o `fixtures` não escuta; o critério é só sobre a auditoria criada.
      const { id } = await createAudit(request, "fixtures");
      const audit = await getAudit(request, id);
      await attachObserved(testInfo, { input: "fixtures", audit });

      expect(audit.start_url).toBe("https://fixtures/");
    },
  );
});
