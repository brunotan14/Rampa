import { expect, test } from "@playwright/test";
import { createAudit, fixtureUrl, getWcagCriteria, listFindings, newClientIp, waitForAuditEnd } from "./support/api.js";
import { openBrowserPage } from "./support/browser.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";

// RF-RA007 (M3, feat/criterios-wcag-emag) contra o backend real: o achado `image-alt` da
// `img-sem-alt.html` (critério 1.1.1) abre com o conteúdo do catálogo servido pelo app
// (`GET /api/wcag/criteria`, oráculo do título, resumo, link e eMAG). Os demais critérios, a
// falha do catálogo e o axe nos dois estados ficam em `e2e/tests/rf-ra007-criterios.spec.ts`.

const CA1_1 =
  'RF-RA007 CA1.1: Given um achado ligado ao critério 1.1.1, When abro o detalhe do problema, Then vejo "1.1.1 Conteúdo não textual", o nível "A", um resumo em português do que o critério pede e um link para a referência oficial do critério.';
const CA3_1 =
  'RF-RA007 CA3.1: Given um achado ligado ao critério 1.1.1, When abro o detalhe, Then vejo, sob "Recomendações do eMAG que citam o critério 1.1.1", a recomendação 3.6 com número e título, e um único link para o documento oficial do eMAG.';

const RELATED = "Critérios relacionados";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test(
  "RF-RA007 CA1.1 e CA3.1: o achado 1.1.1 da img-sem-alt.html mostra título, nível, resumo, link da W3C e a recomendação 3.6 do eMAG",
  { annotation: [requirement(CA1_1), requirement(CA3_1)] },
  async ({ browser, request }, testInfo) => {
    const clientIp = newClientIp();
    const { id } = await createAudit(request, fixtureUrl("img-sem-alt.html"), { clientIp });
    const audit = await waitForAuditEnd(request, id);
    expect(audit.status, JSON.stringify(audit)).toBe("completed");
    const [finding] = await listFindings(request, id, { filters: { source: "axe" } }).then((all) =>
      all.filter((f) => f.rule_id === "image-alt"),
    );
    expect(finding?.wcag_criteria, JSON.stringify(finding)).toEqual(["1.1.1"]);
    const catalog = await getWcagCriteria(request);
    const criterion = catalog.data.find((c) => c.id === "1.1.1");
    expect(criterion, "1.1.1 no catálogo da API").toBeDefined();

    const { context, page } = await openBrowserPage(browser, clientIp);
    try {
      await page.goto(`/auditorias/${id}/problemas/${finding!.id}`);
      const section = page.getByRole("region", { name: RELATED });
      await expect(section.getByRole("heading", { level: 3 })).toHaveText(`1.1.1 ${criterion!.title}`);
      const official = section.getByRole("link", { name: /^Critério 1\.1\.1 na WCAG 2\.2 em português \(W3C\)/ });
      const emagItems = section.getByRole("list").getByRole("listitem");
      const emagDoc = section.getByRole("link", { name: /^Documento do eMAG 3\.1 \(Governo Federal\)/ });
      const shown = {
        heading: await section.getByRole("heading", { level: 3 }).textContent(),
        level: await section.getByText(/^Nível A{1,3}$/).allTextContents(),
        summaryShown: await section.getByText(criterion!.summary, { exact: true }).count(),
        officialHref: await official.getAttribute("href"),
        emagHeading: await section.getByRole("heading", { level: 4 }).allTextContents(),
        emagItems: await emagItems.allTextContents(),
        emagLinks: await emagDoc.evaluateAll((links) => links.map((a) => a.getAttribute("href"))),
      };
      await attachObserved(testInfo, { finding, api: { criterion, sources: catalog.sources }, shown });

      // CA1.1
      expect(criterion!.level).toBe("A");
      expect(shown.level).toEqual(["Nível A"]);
      expect(shown.summaryShown).toBe(1);
      expect(shown.officialHref).toBe(criterion!.url);
      expect(shown.officialHref).toMatch(/^https:\/\/www\.w3\.org\/Translations\/WCAG22-pt-BR\//);
      // CA3.1
      expect(shown.emagHeading).toEqual(["Recomendações do eMAG que citam o critério 1.1.1"]);
      expect(shown.emagItems).toEqual(criterion!.emag.map((r) => `${r.id} ${r.title}`));
      expect(shown.emagItems).toContain("3.6 Fornecer alternativa em texto para as imagens do sítio");
      expect(shown.emagLinks).toEqual([catalog.sources.emag.url]);
    } finally {
      await context.close();
    }
  },
);
