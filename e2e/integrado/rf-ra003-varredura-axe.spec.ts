import { expect, test } from "@playwright/test";
import { createAudit, fixtureUrl, listFindings, waitForAuditEnd } from "./support/api.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";

// RF-RA003: varredura com o axe-core. O primeiro critério (`img-sem-alt.html` com `image-alt`
// crítico no 1.1.1) é o caso de fumaça, em `smoke.spec.ts`.

const CA2 =
  "RF-RA003 CA2: Dado a página de fixture `limpa.html`, quando ela é varrida, então nenhum achado com `needs_review = false` é criado.";
const INCOMPLETE_RULE =
  "RF-RA003 (regra): `incomplete` (o axe não conseguiu decidir) viram achados com `needs_review = true`.";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test.describe("RF-RA003: varredura automática com axe-core", () => {
  test(
    "RF-RA003 CA2: limpa.html não gera nenhum achado confirmado (needs_review = false)",
    { annotation: requirement(CA2) },
    async ({ request }, testInfo) => {
      const { id } = await createAudit(request, fixtureUrl("limpa.html"));
      const audit = await waitForAuditEnd(request, id);
      const findings = await listFindings(request, id);
      await attachObserved(testInfo, { audit, findings });

      expect(audit).toMatchObject({
        status: "completed",
        pages_scanned: 1,
        error: null,
        totals_by_severity: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      });
      expect(findings.filter((finding) => !finding.needs_review)).toEqual([]);
    },
  );

  test(
    "RF-RA003: o contraste que o axe não decide vira achado a confirmar (needs_review = true)",
    { annotation: requirement(INCOMPLETE_RULE) },
    async ({ request }, testInfo) => {
      const { id } = await createAudit(request, fixtureUrl("contraste-incerto.html"));
      const audit = await waitForAuditEnd(request, id);
      const findings = await listFindings(request, id);
      await attachObserved(testInfo, { audit, findings });

      expect(audit).toMatchObject({ status: "completed", pages_scanned: 1, error: null });
      expect(audit.needs_review_count).toBeGreaterThanOrEqual(1);
      expect(findings).toContainEqual(
        expect.objectContaining({ source: "axe", rule_id: "color-contrast", needs_review: true }),
      );
      // Achado incerto não entra nos totais por severidade, que só contam os confirmados.
      expect(audit.totals_by_severity).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0 });
    },
  );
});
