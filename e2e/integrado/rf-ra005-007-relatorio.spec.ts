import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { TEXT_SPACING, axeViolations, horizontalOverflow } from "../tests/a11y.js";
import {
  createAudit,
  fixtureUrl,
  getAudit,
  getFinding,
  getPage,
  listFindings,
  listPages,
  newClientIp,
  waitForAuditEnd,
  type Finding,
} from "./support/api.js";
import { openBrowserPage } from "./support/browser.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";
import { screenTexts } from "./support/messages.js";

// RF-RA005, RF-RA006, RF-RA007 e RF-RA017 pelo navegador, contra o backend real: o relatório da
// `relatorio-variado.html` (achados críticos, sérios, moderados e menores, e dois que pedem
// confirmação), com a API como oráculo de cada número e texto. A mesma tela com a API simulada
// fica em `e2e/tests/relatorio.spec.ts`. São 9 achados, menos que uma página da API (50): o
// "Mostrar mais problemas" não aparece aqui.

const FIXTURE = "relatorio-variado.html";
const HOST = "fixtures";
const PAGE_TITLE = "Problemas de severidades diferentes";

const TOTALS =
  "RF-RA005: Totais por severidade, separando \"automático\" de \"revisão necessária\". (M2: Totais numa tabela com \"Confirmados automaticamente\" × \"Pedem confirmação manual\" (`totals_by_severity` × `needs_review_by_severity`).)";
const TOP5 = "RF-RA005: Os 5 problemas mais frequentes, com quantas páginas cada um afeta.";
const DISCLAIMER =
  "RF-RA005: Aviso fixo: a verificação automática não garante conformidade nem substitui a avaliação com pessoas e tecnologias assistivas.";
const URL_FILTERS = "RF-RA006: Filtros refletidos na URL (link compartilhável mantém o filtro).";
const PAGE_LIST =
  "RF-RA006 (M2): a lista de páginas (`/paginas`) ordena (mais graves, endereço exibido `final_url ?? url`, status) e filtra por severidade e \"revisão necessária\"; [...] o link leva os filtros e nunca abre uma página vazia por diferença de regra.";
const PAGE_FILTERS =
  "RF-RA006 (M2): origem e critério WCAG filtram os problemas na tela da página (`/paginas/:pageId`, pela API de achados).";
const PASSED_CA2 =
  "RF-RA017 CA2: Dado qualquer página, quando vejo a aba \"Aprovados\", então nenhum texto afirma que a página ou o site é acessível.";
const PASSED_RULES =
  "RF-RA017: A aba mostra \"Aprovado\" (selo `sucesso`) por regra, nunca \"página acessível\".";
const DETAIL_SEVERITY = "RF-RA007: Severidade (cor + ícone + rótulo), origem e, se for IA, confiança e justificativa.";
const DETAIL_ELEMENT = "RF-RA007: Elemento afetado: seletor, trecho de HTML e recorte de tela do elemento (M4).";
const A11Y =
  "RNF-RA001: Acessibilidade da própria interface: WCAG 2.2 AA. CI falha com qualquer violação do axe nas telas do Rampa.";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

/** Auditoria concluída da fixture, com o IP simulado que o navegador vai usar. */
async function auditedFixture(request: APIRequestContext) {
  const clientIp = newClientIp();
  const { id } = await createAudit(request, fixtureUrl(FIXTURE), { clientIp });
  const audit = await waitForAuditEnd(request, id);
  expect(audit.status, JSON.stringify(audit)).toBe("completed");
  const [pageInfo] = await listPages(request, id);
  return { id, clientIp, audit, pageId: pageInfo!.id };
}

/** Os seletores dos links "Ver o problema no elemento" da lista de problemas da página. */
async function shownSelectors(page: Page): Promise<string[]> {
  const links = page.getByRole("link", { name: /^Ver o problema no elemento/ });
  return (await links.locator("code").allTextContents()).sort();
}

const selectorsOf = (findings: Finding[]) => findings.map((f) => f.selector ?? "").sort();

// O app serve a tela com CSP (`style-src 'self'`), que recusa o `addStyleTag`. Uma folha
// construída (CSSOM) não passa pela CSP e muda o layout do mesmo jeito.
async function applyStyle(page: Page, css: string): Promise<void> {
  await page.evaluate((text) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, css);
}

test.describe("RF-RA005 a RF-RA007: relatório completo contra o backend real", () => {
  test(
    "RF-RA005: resumo com os totais confirmados × para confirmar, o top 5 e o aviso fixo iguais aos da API",
    { annotation: [requirement(TOTALS), requirement(TOP5), requirement(DISCLAIMER)] },
    async ({ browser, request }, testInfo) => {
      const { id, clientIp, audit } = await auditedFixture(request);
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: `Relatório de ${HOST}` })).toBeVisible();
      const table = page.getByRole("table", { name: "Problemas confirmados e para confirmar, por severidade" });
      const rows = await table.getByRole("row").allInnerTexts();
      const top = page.getByRole("region", { name: "Os problemas mais frequentes" }).getByRole("listitem");
      const topShown = await top.evaluateAll((items) =>
        items.map((item) => ({
          heading: item.querySelector("h3")?.textContent?.trim() ?? "",
          text: item.textContent ?? "",
          href: item.querySelector("a")?.getAttribute("href") ?? "",
        })),
      );
      const disclaimer = await page.getByText(screenTexts.disclaimer).isVisible();
      await attachObserved(testInfo, { audit, rows, topShown, disclaimer });

      expect(audit.top_issues.length).toBeGreaterThan(1);
      for (const [severity, label] of Object.entries(screenTexts.severity) as [keyof typeof screenTexts.severity, string][]) {
        const auto = audit.totals_by_severity[severity];
        const review = audit.needs_review_by_severity[severity];
        await expect(table.getByRole("row", { name: `${label} ${auto} ${review}`, exact: true })).toBeVisible();
      }
      const confirmed = Object.values(audit.totals_by_severity).reduce((a, b) => a + b, 0);
      await expect(table.getByRole("row", { name: `Total ${confirmed} ${audit.needs_review_count}`, exact: true })).toBeVisible();

      // Mesma ordem e mesmos números da API, com o link para o achado de exemplo.
      expect(topShown).toHaveLength(audit.top_issues.length);
      audit.top_issues.forEach((issue, index) => {
        const shown = topShown[index]!;
        const pages = `Em ${issue.pages_affected} ${issue.pages_affected === 1 ? "página" : "páginas"}`;
        const occurrences = `${issue.occurrences} ${issue.occurrences === 1 ? "ocorrência" : "ocorrências"}`;
        expect(shown.heading).toBe(`${index + 1}º: ${issue.help ?? `Regra ${issue.rule_id}`}`);
        expect(shown.text).toContain(screenTexts.severity[issue.severity]);
        expect(shown.text).toContain(`${pages} · ${occurrences}`);
        expect(shown.href).toBe(`/auditorias/${id}/problemas/${issue.sample_finding_id}`);
      });
      expect(disclaimer).toBe(true);
      await context.close();
    },
  );

  test(
    "RF-RA006: filtro de severidade na URL da lista de páginas, no link compartilhado e no link da página",
    { annotation: [requirement(URL_FILTERS), requirement(PAGE_LIST)] },
    async ({ browser, request }, testInfo) => {
      const { id, clientIp, pageId } = await auditedFixture(request);
      const critical = await listFindings(request, id, { filters: { page_id: pageId, severity: "critical" } });
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}/paginas`);
      await expect(page.getByRole("status")).toHaveText("1 de 1 página");
      await page.getByRole("combobox", { name: "Severidade" }).selectOption("critico");
      await expect(page).toHaveURL(new RegExp(`/auditorias/${id}/paginas\\?severidade=critico$`));
      await expect(page.getByRole("status")).toHaveText("1 de 1 página");
      const link = page.getByRole("list", { name: "Páginas da auditoria" }).getByRole("link", { name: PAGE_TITLE });
      const href = await link.getAttribute("href");

      // O link copiado da barra de endereço abre com o mesmo filtro.
      const shared = await context.newPage();
      await shared.goto(page.url());
      await expect(shared.getByRole("status")).toHaveText("1 de 1 página");
      const sharedValue = await shared.getByRole("combobox", { name: "Severidade" }).inputValue();
      await shared.close();

      await link.click();
      const h1 = page.getByRole("heading", { level: 1, name: PAGE_TITLE });
      await expect(h1).toBeFocused();
      const status = page.getByRole("tabpanel").getByRole("status");
      await expect(status).toHaveText(`${critical.length} problemas com estes filtros.`);
      const pageValue = await page.getByRole("combobox", { name: "Severidade" }).inputValue();
      const selectors = await shownSelectors(page);
      await attachObserved(testInfo, { href, sharedValue, pageValue, selectors, api: critical, url: page.url() });

      expect(href).toBe(`/auditorias/${id}/paginas/${pageId}?severidade=critico`);
      expect(sharedValue).toBe("critico");
      expect(pageValue).toBe("critico");
      expect(critical.length).toBeGreaterThan(0);
      expect(selectors).toEqual(selectorsOf(critical));
      await context.close();
    },
  );

  test(
    "RF-RA006: na página, os filtros de origem e de critério WCAG vão para a URL e mostram os achados da API",
    { annotation: [requirement(PAGE_FILTERS), requirement(URL_FILTERS)] },
    async ({ browser, request }, testInfo) => {
      const { id, clientIp, pageId } = await auditedFixture(request);
      const byAxe = await listFindings(request, id, { filters: { page_id: pageId, source: "axe" } });
      const byAi = await listFindings(request, id, { filters: { page_id: pageId, source: "ai" } });
      const byWcag = await listFindings(request, id, { filters: { page_id: pageId, wcag: "1.1.1" } });
      const byAxeAndWcag = await listFindings(request, id, { filters: { page_id: pageId, source: "axe", wcag: "1.4.3" } });
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}/paginas/${pageId}`);
      const status = page.getByRole("tabpanel").getByRole("status");
      const origin = page.getByRole("combobox", { name: "Origem" });
      const wcag = page.getByRole("textbox", { name: "Critério WCAG" });
      const apply = page.getByRole("button", { name: "Filtrar" });
      await expect(status).toHaveText(`${byAxe.length} problemas.`);

      await origin.selectOption("axe");
      await apply.click();
      await expect(page).toHaveURL(/\?origem=axe$/);
      await expect(status).toHaveText(`${byAxe.length} problemas com estes filtros.`);
      await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(byAxe));
      const axeSelectors = await shownSelectors(page);

      await origin.selectOption("ai");
      await apply.click();
      await expect(page).toHaveURL(/\?origem=ia$/);
      await expect(page.getByRole("heading", { name: "Nenhum problema com esses filtros" })).toBeVisible();
      const aiStatus = await status.textContent();

      await origin.selectOption("");
      await wcag.fill("1.1.1");
      await wcag.press("Enter");
      await expect(page).toHaveURL(/\?wcag=1\.1\.1$/);
      await expect(status).toHaveText(`${byWcag.length} problemas com estes filtros.`);
      await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(byWcag));
      const wcagSelectors = await shownSelectors(page);

      await origin.selectOption("axe");
      await wcag.fill("1.4.3");
      await apply.click();
      await expect(page).toHaveURL(/\?origem=axe&wcag=1\.4\.3$/);
      await expect(status).toHaveText(`${byAxeAndWcag.length} problemas com estes filtros.`);
      await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(byAxeAndWcag));
      const bothSelectors = await shownSelectors(page);
      await attachObserved(testInfo, {
        api: { byAxe: byAxe.length, byAi: byAi.length, byWcag, byAxeAndWcag },
        screen: { axeSelectors, aiStatus, wcagSelectors, bothSelectors },
      });

      expect(axeSelectors).toEqual(selectorsOf(byAxe));
      expect(byAi).toEqual([]);
      expect(wcagSelectors).toEqual(selectorsOf(byWcag));
      expect(byWcag.every((f) => f.wcag_criteria.includes("1.1.1"))).toBe(true);
      expect(bothSelectors).toEqual(selectorsOf(byAxeAndWcag));
      // 1.4.3 tem um achado confirmado e um que pede confirmação.
      expect(byAxeAndWcag.map((f) => f.needs_review).sort()).toEqual([false, true]);
      await context.close();
    },
  );

  test(
    "RF-RA017: a aba \"Aprovados\" lista as regras aprovadas da API, cada uma com \"Aprovado\", sem prometer acessibilidade",
    { annotation: [requirement(PASSED_RULES), requirement(PASSED_CA2)] },
    async ({ browser, request }, testInfo) => {
      const { id, clientIp, pageId } = await auditedFixture(request);
      const detail = await getPage(request, id, pageId);
      const { context, page } = await openBrowserPage(browser, clientIp);

      await page.goto(`/auditorias/${id}/paginas/${pageId}`);
      await page.getByRole("tab", { name: /Aprovados/ }).click();
      await expect(page).toHaveURL(/\?aba=aprovados$/);
      const rules = page.getByRole("list", { name: "Regras aprovadas" }).getByRole("listitem");
      await expect(rules.first()).toBeVisible();
      const shownRules = await rules.locator("code").allTextContents();
      const texts = await rules.allTextContents();
      const mainText = (await page.getByRole("main").textContent()) ?? "";
      await attachObserved(testInfo, { api: detail.passed_rules, shownRules, texts });

      expect(detail.passed_rules?.length).toBeGreaterThan(0);
      expect(shownRules).toEqual(detail.passed_rules!.map((rule) => rule.rule_id));
      for (const text of texts) expect(text).toContain(screenTexts.passed);
      expect(mainText).not.toMatch(/acessível|conforme/i);
      await context.close();
    },
  );

  test(
    "RF-RA007: o detalhe de cada problema mostra a severidade, o seletor e o trecho de HTML da API",
    { annotation: [requirement(DETAIL_SEVERITY), requirement(DETAIL_ELEMENT)] },
    async ({ browser, request }, testInfo) => {
      const { id, clientIp, pageId } = await auditedFixture(request);
      const findings = await listFindings(request, id, { filters: { page_id: pageId } });
      const { context, page } = await openBrowserPage(browser, clientIp);

      // O primeiro pelo caminho de quem usa: o link do elemento na lista da página.
      await page.goto(`/auditorias/${id}/paginas/${pageId}`);
      await page.getByRole("link", { name: `Ver o problema no elemento ${findings[0]!.selector}` }).first().click();
      await expect(page).toHaveURL(new RegExp(`/problemas/${findings[0]!.id}$`));

      const observed = [];
      for (const [index, finding] of findings.entries()) {
        const api = await getFinding(request, id, finding.id);
        if (index > 0) await page.goto(`/auditorias/${id}/problemas/${finding.id}`);
        const h1 = page.getByRole("heading", { level: 1 });
        await expect(h1).toHaveText(api.help ?? `Regra ${api.rule_id}`);
        const aside = page.getByRole("complementary", { name: "Detalhes do problema" });
        const definition = (term: string) => aside.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
        const shown = {
          id: finding.id,
          severity: ((await definition("Severidade").textContent()) ?? "").trim(),
          selector: ((await definition("Elemento").locator("code").textContent()) ?? "").trim(),
          snippet: (await page.getByRole("region", { name: "Código encontrado" }).locator("code").textContent()) ?? "",
          severityIcon: await definition("Severidade").locator("svg").count(),
        };
        observed.push({ api: { severity: api.severity, selector: api.selector, html_snippet: api.html_snippet }, shown });

        expect(shown.severity).toBe(screenTexts.severity[api.severity]);
        expect(shown.severityIcon).toBe(1);
        expect(shown.selector).toBe(api.selector);
        expect(shown.snippet).toBe(api.html_snippet);
      }
      await attachObserved(testInfo, { count: findings.length, observed });
      expect(new Set(findings.map((f) => f.severity)).size).toBe(4);
      await context.close();
    },
  );
});

// Telas do relatório com dados reais: axe nos temas e mídias de `e2e/tests/relatorio.spec.ts`,
// e sem rolagem horizontal em 320px, com zoom de 200% e com espaçamento de texto.
const MEDIA = [
  { colorScheme: "light" },
  { colorScheme: "dark" },
  { contrast: "more" },
  { forcedColors: "active" },
  { reducedMotion: "reduce" },
] as const;
const NO_MEDIA = { colorScheme: null, contrast: null, forcedColors: null, reducedMotion: "reduce" } as const;

interface Screen {
  name: string;
  path: (ids: { id: string; pageId: string; findingId: string }) => string;
  h1: (help: string) => string;
  ready: (page: Page) => Locator;
}

const SCREENS: Screen[] = [
  {
    name: "resumo",
    path: ({ id }) => `/auditorias/${id}`,
    h1: () => `Relatório de ${HOST}`,
    ready: (page) => page.getByText("Problemas confirmados", { exact: true }),
  },
  {
    name: "páginas",
    path: ({ id }) => `/auditorias/${id}/paginas?severidade=critico`,
    h1: () => `Páginas auditadas em ${HOST}`,
    ready: (page) => page.getByText("1 de 1 página", { exact: true }),
  },
  {
    name: "página (problemas)",
    path: ({ id, pageId }) => `/auditorias/${id}/paginas/${pageId}`,
    h1: () => PAGE_TITLE,
    ready: (page) => page.getByText(/^\d+ problemas\.$/),
  },
  {
    name: "página (aprovados)",
    path: ({ id, pageId }) => `/auditorias/${id}/paginas/${pageId}?aba=aprovados`,
    h1: () => PAGE_TITLE,
    ready: (page) => page.getByText(screenTexts.passed, { exact: true }).first(),
  },
  {
    name: "problema",
    path: ({ id, findingId }) => `/auditorias/${id}/problemas/${findingId}`,
    h1: (help) => help,
    ready: (page) => page.getByText("Código encontrado", { exact: true }),
  },
];

for (const screen of SCREENS) {
  test(
    `RNF-RA001: ${screen.name} com dados reais, sem violações do axe nos temas e sem rolagem horizontal`,
    { annotation: requirement(A11Y) },
    async ({ browser, request }, testInfo) => {
      const { id, clientIp, pageId } = await auditedFixture(request);
      // O achado que pede confirmação mostra também o selo de revisão.
      const [review] = await listFindings(request, id, { filters: { page_id: pageId, needs_review: true } });
      const finding = await getFinding(request, id, review!.id);
      const path = screen.path({ id, pageId, findingId: finding.id });
      const h1Name = screen.h1(finding.help ?? `Regra ${finding.rule_id}`);
      const { context, page } = await openBrowserPage(browser, clientIp);

      const axe: Record<string, string[]> = {};
      for (const media of MEDIA) {
        // O `emulateMedia` guarda o que veio antes: cada mídia começa do padrão, como uma página nova.
        await page.emulateMedia({ ...NO_MEDIA, ...media });
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: h1Name })).toBeVisible();
        await expect(screen.ready(page)).toBeVisible();
        axe[JSON.stringify(media)] = await axeViolations(page);
      }

      await page.emulateMedia(NO_MEDIA);
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(path);
      await expect(screen.ready(page)).toBeVisible();
      const overflow320 = await horizontalOverflow(page);
      await page.setViewportSize({ width: 640, height: 480 });
      await applyStyle(page, "html { font-size: 200% !important; }");
      const overflowZoom = await horizontalOverflow(page);
      await applyStyle(page, TEXT_SPACING);
      const overflowSpacing = await horizontalOverflow(page);
      const audit = await getAudit(request, id);
      await attachObserved(testInfo, { path, status: audit.status, axe, overflow320, overflowZoom, overflowSpacing });

      for (const [media, violations] of Object.entries(axe)) expect(violations, media).toEqual([]);
      expect(overflow320).toBeLessThanOrEqual(0);
      expect(overflowZoom).toBeLessThanOrEqual(0);
      expect(overflowSpacing).toBeLessThanOrEqual(0);
      await context.close();
    },
  );
}
