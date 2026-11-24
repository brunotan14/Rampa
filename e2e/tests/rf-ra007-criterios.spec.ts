import { expect, test, type Page } from "@playwright/test";
import { A11Y_MEDIA, axeViolations, emulateOnly, revealAll } from "./a11y.js";
import { AUDIT_ID, PAGE_ID, PhoenixMock, WCAG_CATALOG, WCAG_CRITERIA_PATH, ZERO, progress, summary } from "./simulado.js";

// RF-RA007 (M3, feat/criterios-wcag-emag), com a API e o canal simulados: o detalhe do problema
// mostra cada critério com título, nível, resumo, link da W3C e as recomendações do eMAG 3.1 que
// o citam, e "Quem é afetado" em português; sem o catálogo (`GET /api/wcag/criteria` com falha),
// o detalhe monta como no M2, só com os números. Os textos afirmados são os de
// `frontend/src/i18n/pt-BR.ts` (report.criteria) e os do catálogo do simulado (`shared/wcag/`).

const ALT_ID = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";
const CONTRAST_ID = "7a8b9c0d-1e2f-4a3b-8c4d-e5f6a7b8c9d0";
const TARGET_ID = "8b9c0d1e-2f3a-4b4c-9d5e-f6a7b8c9d0e1";

const REPORT = `/auditorias/${AUDIT_ID}`;
const PAGE = `/auditorias/${AUDIT_ID}/paginas/${PAGE_ID}`;
const finding = (id: string) => `/auditorias/${AUDIT_ID}/problemas/${id}`;

const ALT_HELP = "Images must have alternative text";
const RELATED = "Critérios relacionados";
const WHO = "Quem é afetado";
const EMAG_DOC = "Documento do eMAG 3.1 (Governo Federal)";
const EMAG_BEFORE = "O eMAG 3.1 (2014) é anterior a este critério e não o cita.";

const criterion = (id: string) => {
  const found = WCAG_CATALOG.data.find((c) => c.id === id);
  if (found === undefined) throw new Error(`critério ${id} fora do catálogo do simulado`);
  return found;
};

const PAGE_URL = "https://exemplo.com.br/servicos/agendamento-online";
const PAGE_TITLE = "Agendamento on-line de serviços da prefeitura";

const findings = [
  {
    id: ALT_ID,
    rule_id: "image-alt",
    help: ALT_HELP,
    wcag_criteria: ["1.1.1"],
    severity: "critical",
    needs_review: false,
    selector: "main img.mapa",
    html_snippet: '<img class="mapa" src="/imagens/mapa.png">',
    message: "Fix any of the following:\n  Element does not have an alt attribute",
  },
  {
    id: CONTRAST_ID,
    rule_id: "color-contrast",
    help: "Elements must meet minimum color contrast ratio thresholds",
    wcag_criteria: ["1.4.3"],
    severity: "serious",
    needs_review: false,
    selector: "footer p.legal",
    html_snippet: '<p class="legal">Texto do rodapé</p>',
    message: "Fix any of the following:\n  Element has insufficient color contrast",
  },
  {
    id: TARGET_ID,
    rule_id: "target-size",
    help: "All touch targets must be 24px large, or leave sufficient space",
    wcag_criteria: ["2.5.8"],
    severity: "serious",
    needs_review: false,
    selector: "nav a.icone",
    html_snippet: '<a class="icone" href="/busca">🔍</a>',
    message: "Fix any of the following:\n  Target has insufficient size",
  },
].map((f) => ({ ...f, page_id: PAGE_ID, source: "axe", confidence: null }));

const done = progress({ status: "completed", pages_scanned: 1, totals_by_severity: { ...ZERO, critical: 1, serious: 2 } });

function pageSummary() {
  return {
    id: PAGE_ID,
    url: PAGE_URL,
    final_url: PAGE_URL,
    title: PAGE_TITLE,
    status: "done",
    http_status: 200,
    error: null,
    login_wall: false,
    scanned_at: new Date().toISOString(),
    counts_by_severity: { ...ZERO, critical: 1, serious: 2 },
    needs_review_count: 0,
    passed_count: 1,
  };
}

/**
 * Relatório concluído com três achados (1.1.1, 1.4.3 e 2.5.8). `catalog: "falha"` responde 500
 * ao catálogo dos critérios, como um backend fora do ar só nessa rota.
 */
async function mockReport(page: Page, catalog: "ok" | "falha" = "ok") {
  await new PhoenixMock({ revision: 4, progress: done }).install(page);
  const audit = {
    ...summary(4, done),
    top_issues: [
      {
        rule_id: "image-alt",
        help: ALT_HELP,
        wcag_criteria: ["1.1.1"],
        severity: "critical",
        pages_affected: 1,
        occurrences: 1,
        sample_finding_id: ALT_ID,
      },
    ],
  };
  const pageDetail = {
    ...pageSummary(),
    axe_version: "4.11.0",
    passed_rules: [{ rule_id: "html-has-lang", help: "<html> element must have a lang attribute", wcag_criteria: ["3.1.1"], nodes_total: 1 }],
  };
  const detail = (f: (typeof findings)[number]) => ({
    ...f,
    audit_id: AUDIT_ID,
    inserted_at: new Date().toISOString(),
    help_url: `https://dequeuniversity.com/rules/axe/4.11/${f.rule_id}`,
    nodes_total: 1,
    axe_version: "4.11.0",
    who_is_affected: null,
    how_to_fix: null,
    ai_reason: null,
    ai_suggestion: null,
    ai_model: null,
    prompt_version: null,
    page: { id: PAGE_ID, url: PAGE_URL, final_url: PAGE_URL, title: PAGE_TITLE },
    occurrences: { page: 1, audit: 1 },
    other_pages: [],
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === WCAG_CRITERIA_PATH) {
      if (catalog === "falha") {
        return route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "Erro interno." } } });
      }
      return route.fulfill({ json: WCAG_CATALOG });
    }
    if (path === `/api/audits/${AUDIT_ID}`) return route.fulfill({ json: audit });
    if (path === `/api/audits/${AUDIT_ID}/pages`) return route.fulfill({ json: { data: [pageSummary()] } });
    if (path === `/api/audits/${AUDIT_ID}/pages/${PAGE_ID}`) return route.fulfill({ json: pageDetail });
    if (path === `/api/audits/${AUDIT_ID}/findings`) {
      return route.fulfill({ json: { data: findings, next_cursor: null, total: findings.length } });
    }
    const one = findings.find((f) => path === `/api/audits/${AUDIT_ID}/findings/${f.id}`);
    if (one) return route.fulfill({ json: detail(one) });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "?" } } });
  });
}

const related = (page: Page) => page.getByRole("region", { name: RELATED });

/** Abre o detalhe e espera o corpo montado (o trecho de código é a primeira seção). */
async function openFinding(page: Page, id: string) {
  await page.goto(finding(id));
  await expect(page.getByRole("heading", { level: 2, name: "Código encontrado" })).toBeVisible();
}

test.describe("RF-RA007: critérios WCAG e eMAG no detalhe do problema", () => {
  test("CA1.1: achado 1.1.1 mostra número e título, \"Nível A\", o resumo e o link da W3C em português", async ({ page }) => {
    await mockReport(page);
    await openFinding(page, ALT_ID);
    const c = criterion("1.1.1");

    const section = related(page);
    await expect(section.getByRole("heading", { level: 3, name: "1.1.1 Conteúdo Não Textual" })).toBeVisible();
    await expect(section.getByText("Nível A", { exact: true })).toBeVisible();
    await expect(section.getByText(c.summary, { exact: true })).toBeVisible();
    const official = section.getByRole("link", { name: /^Critério 1\.1\.1 na WCAG 2\.2 em português \(W3C\)/ });
    await expect(official).toHaveAttribute("href", "https://www.w3.org/Translations/WCAG22-pt-BR/#non-text-content");
    await expect(official).toHaveAttribute("target", "_blank");
    await expect(official).toContainText("(abre em nova aba)");
    // A lateral troca o número pelo rótulo curto.
    await expect(page.getByRole("complementary", { name: "Detalhes do problema" })).toContainText("1.1.1 Conteúdo Não Textual");
  });

  test("CA2.1: achado 1.4.3 tem \"Quem é afetado\" em português, sem a mensagem do axe em inglês", async ({ page }) => {
    await mockReport(page);
    await openFinding(page, CONTRAST_ID);

    const who = page.getByRole("region", { name: WHO });
    await expect(who.getByRole("term")).toHaveText("1.4.3 Contraste (Mínimo)");
    await expect(who.getByRole("definition")).toHaveText(criterion("1.4.3").who_is_affected);
    await expect(who).toContainText("baixa visão");
    await expect(who).not.toContainText("insufficient color contrast");
    // A mensagem do axe continua em "Como corrigir".
    await expect(page.getByRole("region", { name: "Como corrigir" })).toContainText("insufficient color contrast");
  });

  test("CA3.1: achado 1.1.1 lista a recomendação 3.6 do eMAG, com um único link para o documento oficial", async ({ page }) => {
    await mockReport(page);
    await openFinding(page, ALT_ID);

    const section = related(page);
    await expect(section.getByRole("heading", { level: 4, name: "Recomendações do eMAG que citam o critério 1.1.1" })).toBeVisible();
    const items = section.getByRole("list").getByRole("listitem");
    await expect(items).toHaveText([
      "3.6 Fornecer alternativa em texto para as imagens do sítio",
      "3.7 Utilizar mapas de imagem de forma acessível",
      "6.1 Fornecer alternativa em texto para os botões de imagem de formulários",
      "6.8 Fornecer estratégias de segurança específicas ao invés de CAPTCHA",
    ]);
    const doc = section.getByRole("link", { name: new RegExp(`^${EMAG_DOC.replace(/[.()]/g, "\\$&")}`) });
    await expect(doc).toHaveCount(1);
    await expect(doc).toHaveAttribute("href", "https://emag.governoeletronico.gov.br/");
  });

  test("CA3.2: achado 2.5.8 (WCAG 2.2) diz que o eMAG 3.1 é anterior ao critério, sem lista vazia", async ({ page }) => {
    await mockReport(page);
    await openFinding(page, TARGET_ID);

    const section = related(page);
    await expect(section.getByRole("heading", { level: 3, name: "2.5.8 Tamanho do Alvo (Mínimo)" })).toBeVisible();
    await expect(section.getByText("Nível AA", { exact: true })).toBeVisible();
    await expect(section.getByText(EMAG_BEFORE, { exact: true })).toBeVisible();
    await expect(section.getByRole("heading", { level: 4 })).toHaveCount(0);
    await expect(section.getByRole("list")).toHaveCount(0);
    await expect(section.getByRole("link", { name: /Documento do eMAG/ })).toHaveCount(0);
  });

  test("CA1.3: grupo de problemas, aba Aprovados e problemas mais frequentes mostram número e título", async ({ page }) => {
    await mockReport(page);
    await page.goto(REPORT);
    const top = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { level: 3, name: new RegExp(ALT_HELP) }) });
    await expect(top).toContainText("1.1.1 Conteúdo Não Textual");

    await page.goto(PAGE);
    await expect(page.getByRole("article", { name: new RegExp(ALT_HELP) })).toContainText("1.1.1 Conteúdo Não Textual");
    await expect(page.getByRole("article", { name: /color contrast/ })).toContainText("1.4.3 Contraste (Mínimo)");

    await page.goto(`${PAGE}?aba=aprovados`);
    await expect(page.getByRole("list", { name: "Regras aprovadas" }).getByRole("listitem")).toContainText("3.1.1 Idioma da Página");
  });

  test("sem o catálogo (500): o detalhe monta como no M2, só com o número e sem erro na tela", async ({ page }) => {
    await mockReport(page, "falha");
    const failed = page.waitForResponse((r) => r.url().endsWith(WCAG_CRITERIA_PATH) && r.status() === 500);
    await page.goto(finding(ALT_ID));
    await failed;
    await expect(page.getByRole("heading", { level: 1, name: ALT_HELP })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Código encontrado" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Como corrigir" })).toBeVisible();

    await expect(page.getByRole("complementary", { name: "Detalhes do problema" })).toContainText("WCAG 1.1.1");
    await expect(page.getByRole("heading", { name: RELATED })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: WHO })).toHaveCount(0);
    await expect(page.getByText("Conteúdo Não Textual")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(/^Erro:/)).toHaveCount(0);
  });
});

test.describe("RF-RA007 SC-004: axe no detalhe do problema", () => {
  for (const catalog of ["ok", "falha"] as const) {
    for (const media of A11Y_MEDIA) {
      test(`SC-004: catálogo ${catalog}, sem violações do axe (${JSON.stringify(media)})`, async ({ page }) => {
        await emulateOnly(page, media);
        await mockReport(page, catalog);
        await openFinding(page, ALT_ID);
        if (catalog === "ok") await expect(related(page)).toBeVisible();
        else await expect(page.getByRole("complementary", { name: "Detalhes do problema" })).toContainText("WCAG 1.1.1");
        await revealAll(page);
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  }
});
