import { expect, test } from "@playwright/test";
import { createAudit, fixtureUrl, listFindings, waitForAuditEnd } from "./support/api.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";

// Fumaça do E2E integrado: API, fila, scanner real e site de fixtures, de ponta a ponta. É
// também o primeiro critério do RF-RA003; os demais ficam em `rf-ra003-varredura-axe.spec.ts`.

const RF_RA003_CA1 =
  "RF-RA003 CA1: Dado a página de fixture `img-sem-alt.html`, quando ela é varrida, então existe um achado da regra `image-alt` com critério 1.1.1 e severidade crítica.";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test.describe("Fluxo integrado (M1)", () => {
  test(
    "RF-RA003 CA1: auditoria de img-sem-alt.html termina com image-alt crítico no critério 1.1.1",
    { annotation: requirement(RF_RA003_CA1) },
    async ({ request }, testInfo) => {
      const { id } = await createAudit(request, fixtureUrl("img-sem-alt.html"));

      const audit = await waitForAuditEnd(request, id);
      const findings = await listFindings(request, id);
      await attachObserved(testInfo, { audit, findings });

      expect(audit, JSON.stringify(audit)).toMatchObject({
        status: "completed",
        start_url: "http://fixtures/img-sem-alt.html",
        pages_scanned: 1,
        pages_failed: 0,
        error: null,
      });
      expect(findings).toContainEqual(
        expect.objectContaining({
          source: "axe",
          rule_id: "image-alt",
          severity: "critical",
          needs_review: false,
          wcag_criteria: expect.arrayContaining(["1.1.1"]),
        }),
      );
    },
  );
});
