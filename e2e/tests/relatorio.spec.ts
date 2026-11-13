import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "./a11y.js";
import { AUDIT_ID, PAGE_ID, PhoenixMock, TEXT_SPACING, ZERO, horizontalOverflow, progress, summary } from "./simulado.js";

// Telas do relatório (M2, feat/tela-relatorio) com a API e o canal simulados: resumo
// (RF-RA005), páginas (RF-RA006), uma página com as abas Problemas e Aprovados (RF-RA006,
// RF-RA017), detalhe do problema (RF-RA007), barreira de login (RF-RA028) e a falha com
// "Auditar de novo" (RF-RA029). Axe nos temas e com forced-colors, h1 igual ao título, teclado,
// 320px, zoom de 200%, espaçamento de texto e movimento.

const FINDING_ID = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";
const FINDING_2 = "6f7a8b9c-0d1e-4f2a-b3c4-d5e6f7a8b9c0";
const NEW_ID = "11111111-2222-4333-8444-555555555555";

const REPORT = `/auditorias/${AUDIT_ID}`;
const PAGES = `/auditorias/${AUDIT_ID}/paginas`;
const PAGE = `/auditorias/${AUDIT_ID}/paginas/${PAGE_ID}`;
const FINDING = `/auditorias/${AUDIT_ID}/problemas/${FINDING_ID}`;

const LOGIN_WALL = "Esta página pede login. O Rampa auditou a tela de entrada; áreas logadas ainda não são cobertas.";
const DISCLAIMER =
  "A verificação automática não garante conformidade e não substitui a avaliação com pessoas e tecnologias assistivas.";

const done = progress({
  status: "completed",
  pages_scanned: 1,
  totals_by_severity: { ...ZERO, critical: 2, serious: 1 },
  needs_review_count: 1,
});

interface Options {
  loginWall?: boolean;
  /** Resposta do `POST /api/audits` ("Auditar de novo"). */
  create?: { status: number; json: unknown };
  /** Estado da auditoria (canal e resumo); padrão: concluída. */
  state?: ReturnType<typeof progress>;
}

function pageSummary(loginWall: boolean) {
  return {
    id: PAGE_ID,
    url: loginWall ? "https://exemplo.com.br/painel" : "https://exemplo.com.br/servicos/agendamento-online",
    final_url: loginWall ? "https://exemplo.com.br/entrar" : "https://exemplo.com.br/servicos/agendamento-online",
    title: "Agendamento on-line de serviços da prefeitura",
    status: "done",
    http_status: 200,
    error: null,
    login_wall: loginWall,
    scanned_at: new Date().toISOString(),
    counts_by_severity: { ...ZERO, critical: 2, serious: 1 },
    needs_review_count: 1,
    passed_count: 2,
  };
}

const findings = [
  {
    id: FINDING_ID,
    page_id: PAGE_ID,
    source: "axe",
    rule_id: "image-alt",
    help: "Images must have alternative text",
    wcag_criteria: ["1.1.1"],
    severity: "critical",
    needs_review: false,
    confidence: null,
    selector: "main > section.mapa-dos-postos-de-vacinacao-da-cidade > img.mapa-interativo-grande",
    html_snippet: '<img class="mapa-interativo-grande" src="/imagens/mapa-dos-postos-de-vacinacao-da-cidade-2026.png">',
    message: "Fix any of the following:\n  Element does not have an alt attribute",
  },
  {
    id: FINDING_2,
    page_id: PAGE_ID,
    source: "axe",
    rule_id: "image-alt",
    help: "Images must have alternative text",
    wcag_criteria: ["1.1.1"],
    severity: "critical",
    needs_review: false,
    confidence: null,
    selector: "footer img",
    html_snippet: '<img src="selo.png">',
    message: "Fix any of the following:\n  Element does not have an alt attribute",
  },
  {
    id: "7a8b9c0d-1e2f-4a3b-8c4d-e5f6a7b8c9d0",
    page_id: PAGE_ID,
    source: "axe",
    rule_id: "color-contrast",
    help: "Elements must meet minimum color contrast ratio thresholds",
    wcag_criteria: ["1.4.3"],
    severity: "serious",
    needs_review: true,
    confidence: null,
    selector: "footer p.legal",
    html_snippet: '<p class="legal">Texto do rodapé</p>',
    message: "Fix any of the following:\n  Element has insufficient color contrast",
  },
];

async function mockReport(page: Page, options: Options = {}) {
  const loginWall = options.loginWall ?? false;
  const current = options.state ?? done;
  await new PhoenixMock({ revision: 4, progress: current }).install(page);
  const audit = {
    ...summary(4, current),
    login_wall_pages: loginWall ? 1 : 0,
    needs_review_by_severity: { ...ZERO, serious: 1 },
    top_issues: [
      {
        rule_id: "image-alt",
        help: "Images must have alternative text",
        wcag_criteria: ["1.1.1"],
        severity: "critical",
        pages_affected: 1,
        occurrences: 2,
        sample_finding_id: FINDING_ID,
      },
    ],
  };
  const detail = {
    ...pageSummary(loginWall),
    axe_version: "4.11.0",
    passed_rules: [
      { rule_id: "html-has-lang", help: "<html> element must have a lang attribute", wcag_criteria: ["3.1.1"], nodes_total: 1 },
      { rule_id: "document-title", help: "Documents must have <title> element to aid in navigation", wcag_criteria: ["2.4.2"], nodes_total: 1 },
    ],
  };
  const findingDetail = {
    ...findings[0],
    audit_id: AUDIT_ID,
    inserted_at: new Date().toISOString(),
    help_url: "https://dequeuniversity.com/rules/axe/4.11/image-alt",
    nodes_total: 2,
    axe_version: "4.11.0",
    who_is_affected: null,
    how_to_fix: null,
    ai_reason: null,
    ai_suggestion: null,
    ai_model: null,
    prompt_version: null,
    page: { id: PAGE_ID, url: detail.url, final_url: detail.final_url, title: detail.title },
    occurrences: { page: 2, audit: 2 },
    other_pages: [],
  };
  const posts: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/audits" && route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      const create = options.create ?? { status: 202, json: { id: NEW_ID } };
      return route.fulfill({ status: create.status, json: create.json });
    }
    if (path === `/api/audits/${NEW_ID}`) return route.fulfill({ json: { ...summary(1, progress({ status: "queued" })), id: NEW_ID } });
    if (path === `/api/audits/${NEW_ID}/pages`) return route.fulfill({ json: { data: [] } });
    if (path === `/api/audits/${AUDIT_ID}`) return route.fulfill({ json: audit });
    if (path === `/api/audits/${AUDIT_ID}/pages`) return route.fulfill({ json: { data: [pageSummary(loginWall)] } });
    if (path === `/api/audits/${AUDIT_ID}/pages/${PAGE_ID}`) return route.fulfill({ json: detail });
    if (path === `/api/audits/${AUDIT_ID}/findings`) {
      const severity = url.searchParams.get("severity");
      const data = severity ? findings.filter((f) => f.severity === severity) : findings;
      return route.fulfill({ json: { data, next_cursor: null, total: data.length } });
    }
    if (path === `/api/audits/${AUDIT_ID}/findings/${FINDING_ID}`) return route.fulfill({ json: findingDetail });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "?" } } });
  });
  return { posts };
}

// O conteúdo que aparece ao rolar só entra quando chega à tela: rola até o fim antes do axe.
async function revealAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y <= document.documentElement.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));
    }
  });
}

const SCREENS = [
  { name: "resumo", path: REPORT, h1: "Relatório de exemplo.com.br", ready: "Problemas confirmados" },
  { name: "páginas", path: PAGES, h1: "Páginas auditadas em exemplo.com.br", ready: "1 de 1 página" },
  { name: "página (problemas)", path: PAGE, h1: "Agendamento on-line de serviços da prefeitura", ready: "3 problemas." },
  { name: "página (aprovados)", path: `${PAGE}?aba=aprovados`, h1: "Agendamento on-line de serviços da prefeitura", ready: "html-has-lang" },
  { name: "problema", path: FINDING, h1: "Images must have alternative text", ready: "Código encontrado" },
] as const;

for (const screen of SCREENS) {
  test.describe(`Relatório: ${screen.name}`, () => {
    for (const media of [
      { colorScheme: "light" },
      { colorScheme: "dark" },
      { contrast: "more" },
      { forcedColors: "active" },
      { reducedMotion: "reduce" },
    ] as const) {
      test(`sem violações do axe (${JSON.stringify(media)})`, async ({ page }) => {
        await page.emulateMedia(media);
        await mockReport(page, { loginWall: true });
        await page.goto(screen.path);
        await expect(page.getByRole("heading", { level: 1, name: screen.h1 })).toBeVisible();
        await expect(page.getByText(screen.ready, { exact: true }).first()).toBeVisible();
        await revealAll(page);
        expect(await axeViolations(page)).toEqual([]);
      });
    }

    test("h1 igual ao título e marcos", async ({ page }) => {
      await mockReport(page);
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen.h1 })).toBeVisible();
      await expect(page).toHaveTitle(`${screen.h1} – Rampa`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveAttribute("id", "conteudo");
      await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
    });

    test("320px, zoom de 200% e espaçamento de texto não criam rolagem horizontal", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mockReport(page, { loginWall: true });
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(screen.path);
      await expect(page.getByText(screen.ready, { exact: true }).first()).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await page.setViewportSize({ width: 640, height: 480 });
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await page.addStyleTag({ content: TEXT_SPACING });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await expect(page.getByRole("heading", { level: 1, name: screen.h1 })).toBeVisible();
    });
  });
}

test.describe("Relatório: comportamento", () => {
  test("RF-RA005 e RF-RA028: resumo com o aviso fixo, a barreira de login (ícone e texto) e os totais separados", async ({ page }) => {
    await mockReport(page, { loginWall: true });
    await page.goto(REPORT);
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    const notice = page.locator(".rp-notice", { hasText: LOGIN_WALL });
    await expect(notice).toBeVisible();
    await expect(notice.locator("svg")).toBeVisible();
    const table = page.getByRole("table", { name: "Problemas confirmados e para confirmar, por severidade" });
    await expect(table.getByRole("row", { name: /Sério/ })).toContainText("1");
    await expect(page.getByText("Indicador de problemas encontrados automaticamente")).toHaveCount(0);
  });

  test("RF-RA028: sem barreira, nem resumo nem página mostram o aviso", async ({ page }) => {
    await mockReport(page, { loginWall: false });
    await page.goto(REPORT);
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await expect(page.getByText(LOGIN_WALL)).toHaveCount(0);
    await page.goto(PAGE);
    await expect(page.getByText("3 problemas.")).toBeVisible();
    await expect(page.getByText(LOGIN_WALL)).toHaveCount(0);
  });

  test("teclado: ordem do Tab no resumo, com anel de foco visível", async ({ page }) => {
    await mockReport(page);
    await page.goto(REPORT);
    await expect(page.getByText("Problemas confirmados", { exact: true })).toBeVisible();
    const order = [
      ["link", "Pular para o conteúdo"],
      ["link", "Rampa, página inicial"],
      ["link", "Nova auditoria"],
      ["button", "Auditar de novo"],
      ["link", "Ver páginas e problemas"],
    ] as const;
    for (const [role, name] of order) {
      await page.keyboard.press("Tab");
      await expect(page.getByRole(role, { name })).toBeFocused();
      const outline = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element);
        return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
      });
      expect(outline.style).not.toBe("none");
      expect(outline.width).toBeGreaterThanOrEqual(2);
    }
  });

  test("RF-RA006: filtro na URL, link da página leva o filtro, e o foco vai para o h1 da página", async ({ page }) => {
    await mockReport(page);
    await page.goto(PAGES);
    await page.getByRole("combobox", { name: "Severidade" }).selectOption("critico");
    await expect(page).toHaveURL(/\?severidade=critico$/);
    await expect(page.getByRole("status")).toHaveText("1 de 1 página");
    const link = page.getByRole("link", { name: "Agendamento on-line de serviços da prefeitura" });
    await expect(link).toHaveAttribute("href", `${PAGE}?severidade=critico`);
    await link.focus();
    await page.keyboard.press("Enter");
    const h1 = page.getByRole("heading", { level: 1, name: "Agendamento on-line de serviços da prefeitura" });
    await expect(h1).toBeFocused();
    await expect(page.getByRole("combobox", { name: "Severidade" })).toHaveValue("critico");
    await expect(page.getByRole("status")).toHaveText("2 problemas com estes filtros.");
  });

  test("RF-RA006: filtros da página pelo teclado; setas trocam de aba; RF-RA017: 'Aprovado' por regra", async ({ page }) => {
    await mockReport(page);
    await page.goto(PAGE);
    await expect(page.getByText("3 problemas.")).toBeVisible();
    await page.getByRole("combobox", { name: "Severidade" }).selectOption("serio");
    await page.getByRole("textbox", { name: "Critério WCAG" }).fill("1.4.3");
    await page.getByRole("textbox", { name: "Critério WCAG" }).press("Enter");
    await expect(page).toHaveURL(/\?severidade=serio&wcag=1\.4\.3$/);
    await expect(page.getByRole("status")).toHaveText("1 problema com estes filtros.");
    await expect(page.getByRole("textbox", { name: "Critério WCAG" })).toBeFocused();

    await page.getByRole("tab", { name: /Problemas/ }).focus();
    await page.keyboard.press("ArrowRight");
    const passed = page.getByRole("tab", { name: /Aprovados/ });
    await expect(passed).toBeFocused();
    await expect(passed).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/aba=aprovados/);
    const rules = page.getByRole("list", { name: "Regras aprovadas" }).getByRole("listitem");
    await expect(rules).toHaveCount(2);
    for (const rule of await rules.all()) await expect(rule).toContainText("Aprovado");
    await expect(page.locator("main")).not.toContainText(/acessível|conforme/i);
  });

  test("RF-RA007: do card ao detalhe do problema, com o foco no h1 e o trecho de código sem rolar a tela", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockReport(page);
    await page.goto(PAGE);
    await page.getByRole("link", { name: /Ver o problema no elemento main > section/ }).click();
    const h1 = page.getByRole("heading", { level: 1, name: "Images must have alternative text" });
    await expect(h1).toBeFocused();
    await expect(h1).toHaveAttribute("lang", "en");
    await expect(page.getByRole("complementary", { name: "Detalhes do problema" })).toContainText(
      "Automática (axe-core 4.11.0, regra image-alt)",
    );
    await expect(page.locator("pre code")).toContainText("mapa-dos-postos-de-vacinacao-da-cidade-2026.png");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("RF-RA029: 'Auditar de novo' no relatório concluído leva ao progresso da nova auditoria", async ({ page }) => {
    const { posts } = await mockReport(page);
    await page.goto(REPORT);
    await page.getByRole("button", { name: "Auditar de novo" }).click();
    await expect(page).toHaveURL(new RegExp(`/auditorias/${NEW_ID}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Auditando exemplo.com.br" })).toBeFocused();
    expect(posts).toEqual([{ url: "https://exemplo.com.br/", page_limit: 1 }]);
  });

  test("RF-RA029: na tela de falha, a mensagem da API e 'Auditar de novo'; o 429 mostra o horário de liberação", async ({ page }) => {
    const failed = progress({
      status: "failed",
      pages_failed: 1,
      error: { code: "http_error", http_status: 404, message: "A página não foi encontrada (HTTP 404). Confira o endereço." },
    });
    const retryAfter = new Date(Date.now() + 45 * 60_000).toISOString();
    await mockReport(page, {
      state: failed,
      create: { status: 429, json: { error: { code: "rate_limited", message: "Limite.", retry_after: retryAfter } } },
    });
    await page.goto(REPORT);
    await expect(page.getByRole("heading", { level: 1, name: "A auditoria de exemplo.com.br parou" })).toBeVisible();
    await expect(page.getByText("A página não foi encontrada (HTTP 404). Confira o endereço.")).toBeVisible();
    const again = page.getByRole("button", { name: "Auditar de novo" });
    expect(await axeViolations(page)).toEqual([]);
    await again.click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/Você atingiu o limite de auditorias por hora\. Tente de novo a partir (das|de) /);
    await expect(again).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`${REPORT}$`));
    expect(await axeViolations(page)).toEqual([]);
  });

  test("movimento: com movimento, as seções aparecem ao rolar; com movimento reduzido, já estão prontas", async ({ page }) => {
    await mockReport(page);
    await page.goto(REPORT);
    const top = page.locator("section", { has: page.getByRole("heading", { name: "Os problemas mais frequentes" }) });
    await expect(top).toHaveClass(/rp-reveal/);
    await top.scrollIntoViewIfNeeded();
    await expect(top).toHaveClass(/is-in/);
    await expect(top).toHaveCSS("opacity", "1");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.getByText("Problemas confirmados", { exact: true })).toBeVisible();
    await expect(top).not.toHaveClass(/rp-reveal/);
    await expect(top).toHaveCSS("opacity", "1");
  });
});
