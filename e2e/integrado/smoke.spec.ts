import { expect, test } from "@playwright/test";
import { createAudit, fixtureUrl, listFindings, waitForAuditEnd } from "./support/api.js";

// Fumaça do E2E integrado: API, fila, scanner real e site de fixtures, de ponta a ponta
// (RF-RA003, primeiro critério). Os critérios de aceite completos ficam nos outros specs.
test.describe("Fluxo integrado (M1)", () => {
  test("auditoria de img-sem-alt.html termina com image-alt crítico no critério 1.1.1", async ({ request }) => {
    const { id } = await createAudit(request, fixtureUrl("img-sem-alt.html"));

    const audit = await waitForAuditEnd(request, id);
    expect(audit, JSON.stringify(audit)).toMatchObject({
      status: "completed",
      start_url: "http://fixtures/img-sem-alt.html",
      pages_scanned: 1,
      pages_failed: 0,
      error: null,
    });

    const findings = await listFindings(request, id);
    expect(findings).toContainEqual(
      expect.objectContaining({
        source: "axe",
        rule_id: "image-alt",
        severity: "minor",
        needs_review: false,
        wcag_criteria: expect.arrayContaining(["1.1.1"]),
      }),
    );
  });
});
