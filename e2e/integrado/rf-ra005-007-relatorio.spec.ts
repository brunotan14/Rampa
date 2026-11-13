import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  A11Y_MEDIA,
  axeViolations,
  emulateOnly,
  LOGO_MIN_PARTS,
  belowContrast,
  expectNoHorizontalScroll,
  headerLogoContrast,
  reflowOverflow,
  revealAll,
} from "../tests/a11y.js";
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
  type AuditSummary,
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
//
// Os casos só leem o relatório: uma auditoria serve o arquivo inteiro (`serial`, criada no
// `beforeAll`), e cada caso abre o próprio contexto do navegador com o IP dela.

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

/** Texto do link de cada elemento afetado, antes do seletor (ou de "Elemento sem seletor"). */
const ELEMENT_LINK = "Ver o problema no elemento";
const NO_SELECTOR = "Elemento sem seletor";

test.describe.configure({ mode: "serial" });

let report: { id: string; clientIp: string; audit: AuditSummary; pageId: string };

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ extraHTTPHeaders: { accept: "application/json" } });
  try {
    const clientIp = newClientIp();
    const { id } = await createAudit(request, fixtureUrl(FIXTURE), { clientIp });
    const audit = await waitForAuditEnd(request, id);
    expect(audit.status, JSON.stringify(audit)).toBe("completed");
    const [pageInfo] = await listPages(request, id);
    report = { id, clientIp: clientIp!, audit, pageId: pageInfo!.id };
  } finally {
    await request.dispose();
  }
});

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

/** Abre o navegador com o IP da auditoria, roda `body` e fecha o contexto mesmo se falhar. */
async function withBrowserPage(browser: Browser, body: (page: Page) => Promise<void>): Promise<void> {
  const { context, page } = await openBrowserPage(browser, report.clientIp);
  try {
    await body(page);
  } finally {
    await context.close();
  }
}

/** Contagem que a tela anuncia na região viva da lista de problemas. */
function countText(n: number, filtered: boolean): string {
  return `${n} ${n === 1 ? "problema" : "problemas"}${filtered ? " com estes filtros." : "."}`;
}

/** O que vem depois de "Ver o problema no elemento" em cada link da lista, em ordem alfabética. */
async function shownSelectors(page: Page): Promise<string[]> {
  const links = page.getByRole("link", { name: new RegExp(`^${ELEMENT_LINK} `) });
  const texts = await links.evaluateAll((all) => all.map((a) => (a.textContent ?? "").replace(/\s+/g, " ").trim()));
  return texts.map((text) => text.slice(ELEMENT_LINK.length).trim()).sort();
}

const selectorsOf = (findings: Finding[]) => findings.map((f) => f.selector ?? NO_SELECTOR).sort();

/** O link de um achado na lista da página, pelo endereço exato do detalhe. */
function findingLink(page: Page, findingId: string): Locator {
  return page
    .getByRole("link", { name: new RegExp(`^${ELEMENT_LINK} `) })
    .and(page.locator(`[href="/auditorias/${report.id}/problemas/${findingId}"]`));
}

test.describe("RF-RA005 a RF-RA007: relatório completo contra o backend real", () => {
  test(
    "RF-RA005: resumo com os totais confirmados × para confirmar, o top 5 e o aviso fixo iguais aos da API",
    { annotation: [requirement(TOTALS), requirement(TOP5), requirement(DISCLAIMER)] },
    async ({ browser }, testInfo) => {
      const { id, audit } = report;
      await withBrowserPage(browser, async (page) => {
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
      });
    },
  );

  test(
    "RF-RA006: filtro de severidade na URL da lista de páginas, no link compartilhado e no link da página",
    { annotation: [requirement(URL_FILTERS), requirement(PAGE_LIST)] },
    async ({ browser, request }, testInfo) => {
      const { id, pageId } = report;
      const critical = await listFindings(request, id, { filters: { page_id: pageId, severity: "critical" } });
      await withBrowserPage(browser, async (page) => {
        await page.goto(`/auditorias/${id}/paginas`);
        await expect(page.getByRole("status")).toHaveText("1 de 1 página");
        await page.getByRole("combobox", { name: "Severidade" }).selectOption("critico");
        await expect(page).toHaveURL(new RegExp(`/auditorias/${id}/paginas\\?severidade=critico$`));
        await expect(page.getByRole("status")).toHaveText("1 de 1 página");
        const link = page.getByRole("list", { name: "Páginas da auditoria" }).getByRole("link", { name: PAGE_TITLE });
        const href = await link.getAttribute("href");

        // O link copiado da barra de endereço abre com o mesmo filtro.
        const shared = await page.context().newPage();
        await shared.goto(page.url());
        await expect(shared.getByRole("status")).toHaveText("1 de 1 página");
        const sharedValue = await shared.getByRole("combobox", { name: "Severidade" }).inputValue();
        await shared.close();

        await link.click();
        await expect(page.getByRole("heading", { level: 1, name: PAGE_TITLE })).toBeFocused();
        const status = page.getByRole("tabpanel").getByRole("status");
        await expect(status).toHaveText(countText(critical.length, true));
        await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(critical));
        const pageValue = await page.getByRole("combobox", { name: "Severidade" }).inputValue();
        const selectors = await shownSelectors(page);
        await attachObserved(testInfo, { href, sharedValue, pageValue, selectors, api: critical, url: page.url() });

        expect(href).toBe(`/auditorias/${id}/paginas/${pageId}?severidade=critico`);
        expect(sharedValue).toBe("critico");
        expect(pageValue).toBe("critico");
        expect(critical.length).toBeGreaterThan(0);
        expect(selectors).toEqual(selectorsOf(critical));
      });
    },
  );

  test(
    "RF-RA006: na página, os filtros de origem e de critério WCAG vão para a URL e mostram os achados da API",
    { annotation: [requirement(PAGE_FILTERS), requirement(URL_FILTERS)] },
    async ({ browser, request }, testInfo) => {
      const { id, pageId } = report;
      const all = await listFindings(request, id, { filters: { page_id: pageId } });
      const byAxe = await listFindings(request, id, { filters: { page_id: pageId, source: "axe" } });
      const byAi = await listFindings(request, id, { filters: { page_id: pageId, source: "ai" } });
      const byWcag = await listFindings(request, id, { filters: { page_id: pageId, wcag: "1.1.1" } });
      const byAxeAndWcag = await listFindings(request, id, { filters: { page_id: pageId, source: "axe", wcag: "1.4.3" } });

      await withBrowserPage(browser, async (page) => {
        await page.goto(`/auditorias/${id}/paginas/${pageId}`);
        const status = page.getByRole("tabpanel").getByRole("status");
        const origin = page.getByRole("combobox", { name: "Origem" });
        const wcag = page.getByRole("textbox", { name: "Critério WCAG" });
        const apply = page.getByRole("button", { name: "Filtrar" });
        const emptyState = page.getByRole("heading", { name: "Nenhum problema com esses filtros" });
        await expect(status).toHaveText(countText(all.length, false));
        await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(all));
        const allSelectors = await shownSelectors(page);

        await origin.selectOption("axe");
        await apply.click();
        await expect(page).toHaveURL(/\?origem=axe$/);
        await expect(status).toHaveText(countText(byAxe.length, true));
        await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(byAxe));
        const axeSelectors = await shownSelectors(page);

        // O que a API devolve para `source=ai`, vazio ou não (no M2 não há IA; no M4 haverá).
        await origin.selectOption("ai");
        await apply.click();
        await expect(page).toHaveURL(/\?origem=ia$/);
        await expect(status).toHaveText(countText(byAi.length, true));
        await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(byAi));
        const aiStatus = await status.textContent();
        const aiSelectors = await shownSelectors(page);
        const aiEmptyState = await emptyState.isVisible();

        await origin.selectOption("");
        await wcag.fill("1.1.1");
        await wcag.press("Enter");
        await expect(page).toHaveURL(/\?wcag=1\.1\.1$/);
        await expect(status).toHaveText(countText(byWcag.length, true));
        await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(byWcag));
        const wcagSelectors = await shownSelectors(page);

        await origin.selectOption("axe");
        await wcag.fill("1.4.3");
        await apply.click();
        await expect(page).toHaveURL(/\?origem=axe&wcag=1\.4\.3$/);
        await expect(status).toHaveText(countText(byAxeAndWcag.length, true));
        await expect.poll(() => shownSelectors(page)).toEqual(selectorsOf(byAxeAndWcag));
        const bothSelectors = await shownSelectors(page);
        await attachObserved(testInfo, {
          api: { all: all.length, byAxe: byAxe.length, byAi: byAi.length, byWcag, byAxeAndWcag },
          screen: { allSelectors, axeSelectors, aiStatus, aiSelectors, aiEmptyState, wcagSelectors, bothSelectors },
        });

        expect(allSelectors).toEqual(selectorsOf(all));
        expect(axeSelectors).toEqual(selectorsOf(byAxe));
        expect(aiStatus).toBe(countText(byAi.length, true));
        expect(aiSelectors).toEqual(selectorsOf(byAi));
        // O estado vazio aparece só quando a API não devolve nada.
        expect(aiEmptyState).toBe(byAi.length === 0);
        expect(wcagSelectors).toEqual(selectorsOf(byWcag));
        expect(byWcag.every((f) => f.wcag_criteria.includes("1.1.1"))).toBe(true);
        expect(bothSelectors).toEqual(selectorsOf(byAxeAndWcag));
        // 1.4.3 tem um achado confirmado e um que pede confirmação.
        expect(byAxeAndWcag.map((f) => f.needs_review).sort()).toEqual([false, true]);
      });
    },
  );

  test(
    "RF-RA017: a aba \"Aprovados\" lista as regras aprovadas da API, cada uma com \"Aprovado\", sem prometer acessibilidade",
    { annotation: [requirement(PASSED_RULES), requirement(PASSED_CA2)] },
    async ({ browser, request }, testInfo) => {
      const { id, pageId } = report;
      const detail = await getPage(request, id, pageId);
      await withBrowserPage(browser, async (page) => {
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
      });
    },
  );

  test(
    "RF-RA007: o detalhe de cada problema mostra a severidade, o seletor e o trecho de HTML da API",
    { annotation: [requirement(DETAIL_SEVERITY), requirement(DETAIL_ELEMENT)] },
    async ({ browser, request }, testInfo) => {
      const { id, pageId } = report;
      const findings = await listFindings(request, id, { filters: { page_id: pageId } });
      await withBrowserPage(browser, async (page) => {
        // O primeiro pelo caminho de quem usa: o link do elemento na lista da página.
        await page.goto(`/auditorias/${id}/paginas/${pageId}`);
        await findingLink(page, findings[0]!.id).click();
        await expect(page).toHaveURL(new RegExp(`/problemas/${findings[0]!.id}$`));

        const observed = [];
        for (const [index, finding] of findings.entries()) {
          const api = await getFinding(request, id, finding.id);
          if (index > 0) await page.goto(`/auditorias/${id}/problemas/${finding.id}`);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(api.help ?? `Regra ${api.rule_id}`);
          const aside = page.getByRole("complementary", { name: "Detalhes do problema" });
          const definition = (term: string) => aside.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
          const shown = {
            id: finding.id,
            severity: ((await definition("Severidade").textContent()) ?? "").trim(),
            element: ((await definition("Elemento").textContent()) ?? "").trim(),
            snippet: (await page.getByRole("region", { name: "Código encontrado" }).locator("code").textContent()) ?? "",
            severityIcon: await definition("Severidade").locator("svg").count(),
          };
          observed.push({ api: { severity: api.severity, selector: api.selector, html_snippet: api.html_snippet }, shown });

          expect(shown.severity).toBe(screenTexts.severity[api.severity]);
          expect(shown.severityIcon).toBe(1);
          expect(shown.element).toBe(api.selector ?? NO_SELECTOR);
          expect(shown.snippet).toBe(api.html_snippet);
        }
        await attachObserved(testInfo, { count: findings.length, observed });
        expect(new Set(findings.map((f) => f.severity)).size).toBe(4);
      });
    },
  );
});

// Telas do relatório com dados reais: as mesmas checagens do RNF-RA001 que o `make e2e` aplica
// às telas com a API simulada (`e2e/tests/a11y.ts`).
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

test.describe("RNF-RA001: telas do relatório com dados reais", () => {
  for (const screen of SCREENS) {
    test(
      `${screen.name}: sem violações do axe nos temas e sem rolagem horizontal`,
      { annotation: requirement(A11Y) },
      async ({ browser, request }, testInfo) => {
        const { id, pageId } = report;
        // O achado que pede confirmação mostra também o selo de revisão.
        const [review] = await listFindings(request, id, { filters: { page_id: pageId, needs_review: true } });
        const finding = await getFinding(request, id, review!.id);
        const path = screen.path({ id, pageId, findingId: finding.id });
        const h1Name = screen.h1(finding.help ?? `Regra ${finding.rule_id}`);

        await withBrowserPage(browser, async (page) => {
          const open = async () => {
            await page.goto(path);
            await expect(page.getByRole("heading", { level: 1, name: h1Name })).toBeVisible();
            await expect(screen.ready(page)).toBeVisible();
          };
          const axe: Record<string, string[]> = {};
          // Partes do logotipo abaixo de 3:1 (o axe não mede SVG; ver `headerLogoContrast`).
          const logo: Record<string, { found: number; failing: unknown[] }> = {};
          for (const media of A11Y_MEDIA) {
            await emulateOnly(page, media);
            await open();
            await revealAll(page);
            axe[JSON.stringify(media)] = await axeViolations(page);
            const parts = await headerLogoContrast(page);
            logo[JSON.stringify(media)] = { found: parts.length, failing: belowContrast(parts, 3) };
          }
          const reflow = await reflowOverflow(page, open);
          const audit = await getAudit(request, id);
          await attachObserved(testInfo, { path, status: audit.status, axe, logo, reflow });

          for (const [media, violations] of Object.entries(axe)) expect(violations, media).toEqual([]);
          for (const [media, { found, failing }] of Object.entries(logo)) {
            expect(found, `logo ${media}: partes encontradas`).toBeGreaterThan(LOGO_MIN_PARTS);
            expect(failing, `logo ${media}`).toEqual([]);
          }
          expectNoHorizontalScroll(reflow);
        });
      },
    );
  }
});
