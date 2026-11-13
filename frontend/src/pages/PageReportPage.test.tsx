import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiError, stubApi } from "../../test/api";
import { AUDIT_ID, PAGE_ID, auditSummary, finding, pageDetail } from "../../test/fixtures";
import { axeViolations, jsonResponse, renderRoute } from "../../test/render";
import type { Finding, PageDetail } from "../api/types";
import { LIVE_REFRESH_MS } from "../report";

const PATH = `/auditorias/${AUDIT_ID}/paginas/${PAGE_ID}`;
const FINDINGS = `/api/audits/${AUDIT_ID}/findings`;
const zero = { critical: 0, serious: 0, moderate: 0, minor: 0 };
const fid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const page = pageDetail({
  title: "Contato",
  url: "https://exemplo.com.br/contato",
  final_url: "https://exemplo.com.br/contato",
  counts_by_severity: { ...zero, critical: 2, serious: 1 },
  needs_review_count: 1,
  passed_count: 2,
  passed_rules: [
    { rule_id: "image-alt", help: "Images must have alternative text", wcag_criteria: ["1.1.1"], nodes_total: 1 },
    { rule_id: "html-has-lang", help: "<html> element must have a lang attribute", wcag_criteria: ["3.1.1"], nodes_total: 1 },
  ],
});

const items: Finding[] = [
  finding({ id: fid(1) }),
  finding({ id: fid(2), selector: "footer img" }),
  finding({ id: fid(3), rule_id: "link-name", help: "Links must have discernible text", severity: "serious", wcag_criteria: ["2.4.4", "4.1.2"], selector: "a.mais" }),
  finding({ id: fid(4), rule_id: "color-contrast", help: "Elements must meet minimum color contrast ratio thresholds", severity: "serious", needs_review: true, wcag_criteria: ["1.4.3"], selector: "p.legal" }),
];

function stub({
  detail = page,
  findings = (() => jsonResponse({ data: items, next_cursor: null, total: items.length })) as (url: URL) => Response,
} = {}) {
  return stubApi({
    [`/api/audits/${AUDIT_ID}`]: auditSummary({ status: "completed", pages_scanned: 1 }),
    [`/api/audits/${AUDIT_ID}/pages/${PAGE_ID}`]: detail,
    [FINDINGS]: findings,
  });
}

async function open(path = PATH) {
  const view = renderRoute(path);
  await screen.findByRole("heading", { level: 1, name: "Contato" });
  return view;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Relatório de uma página (RF-RA006, RF-RA017, RF-RA028)", () => {
  it("cabeçalho, totais, aba Problemas com os achados agrupados por regra, do mais grave ao menos grave", async () => {
    const api = stub();
    const { container } = await open();
    expect(document.title).toBe("Contato – Rampa");
    const crumbs = screen.getByRole("navigation", { name: "Você está em" });
    expect(within(crumbs).getAllByRole("link").map((a) => a.textContent)).toEqual(["Relatório de exemplo.com.br", "Páginas"]);
    expect(within(crumbs).getByText("Contato")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("https://exemplo.com.br/contato")).toBeInTheDocument();
    expect(screen.getByText("Analisada", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/pede login/)).not.toBeInTheDocument();

    const tabs = screen.getByRole("tablist", { name: "Resultados desta página" });
    expect(within(tabs).getByRole("tab", { name: "Problemas 4" })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: "Aprovados 2" })).toHaveAttribute("aria-selected", "false");

    expect(await screen.findByRole("status")).toHaveTextContent("4 problemas.");
    const cards = screen.getAllByRole("article");
    expect(cards.map((c) => within(c).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Images must have alternative text",
      "Links must have discernible text",
      "Elements must meet minimum color contrast ratio thresholds",
    ]);
    expect(within(cards[0]!).getAllByRole("link")).toHaveLength(2);
    expect(cards[1]).toHaveTextContent("WCAG 2.4.4, WCAG 4.1.2");
    expect(cards[2]).toHaveTextContent("O axe não conseguiu decidir: confirme manualmente");

    const [request] = api.calls(FINDINGS);
    expect(Object.fromEntries(request!.searchParams)).toEqual({ page_id: PAGE_ID, sort: "severity" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("filtros (severidade, origem, critério e revisão) vão para a URL e para a API; a contagem é anunciada e o foco fica", async () => {
    const api = stub({
      findings: (url) =>
        jsonResponse({ data: url.searchParams.has("severity") ? [items[2]] : items, next_cursor: null, total: url.searchParams.has("severity") ? 1 : 4 }),
    });
    const { router } = await open();
    await screen.findByText("4 problemas.");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Severidade" }), "serio");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Origem" }), "axe");
    await userEvent.type(screen.getByRole("textbox", { name: "Critério WCAG" }), "2.4.4");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Confirmação manual" }), "nao");
    const apply = screen.getByRole("button", { name: "Filtrar" });
    await userEvent.click(apply);

    expect(router.state.location.search).toBe("?severidade=serio&origem=axe&wcag=2.4.4&revisao=nao");
    expect(await screen.findByRole("status")).toHaveTextContent("1 problema com estes filtros.");
    expect(apply).toHaveFocus();
    const last = api.calls(FINDINGS).at(-1)!;
    expect(Object.fromEntries(last.searchParams)).toEqual({
      page_id: PAGE_ID,
      sort: "severity",
      severity: "serious",
      source: "axe",
      wcag: "2.4.4",
      needs_review: "false",
    });

    await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(router.state.location.search).toBe("");
    expect(screen.getByRole("combobox", { name: "Severidade" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Critério WCAG" })).toHaveValue("");
  });

  it("critério WCAG inválido: erro ligado ao campo, foco no campo e nada é enviado", async () => {
    const api = stub();
    const { router } = await open();
    const field = screen.getByRole("textbox", { name: "Critério WCAG" });
    await userEvent.type(field, "1.4");
    await userEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Só o número, como 1.4.3. Escreva o critério só com o número, como 1.4.3.");
    expect(field).toHaveFocus();
    expect(router.state.location.search).toBe("");
    expect(api.calls(FINDINGS)).toHaveLength(1);
  });

  it("link compartilhado com filtros abre filtrado, e sem resultado explica e oferece limpar", async () => {
    stub({ findings: () => jsonResponse({ data: [], next_cursor: null, total: 0 }) });
    const { container } = await open(`${PATH}?severidade=menor`);
    expect(await screen.findByRole("region", { name: "Nenhum problema com esses filtros" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Severidade" })).toHaveValue("menor");
    expect(screen.getByRole("status")).toHaveTextContent("0 problemas com estes filtros.");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("filtro recusado pela API (invalid_filter): a mensagem dela, com 'Tentar de novo'", async () => {
    stub({ findings: () => apiError(422, "invalid_filter", "Um dos filtros não é válido. Limpe os filtros e tente de novo.") });
    await open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Um dos filtros não é válido. Limpe os filtros e tente de novo.");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  it("'Mostrar mais problemas' segue o cursor e leva o foco ao primeiro elemento novo", async () => {
    const api = stub({
      findings: (url) =>
        url.searchParams.get("cursor") === "c1"
          ? jsonResponse({ data: [finding({ id: fid(9), selector: "aside img" })], next_cursor: null, total: null })
          : jsonResponse({ data: items.slice(0, 2), next_cursor: "c1", total: 3 }),
    });
    await open();
    expect(await screen.findByText("Mostrando 2 de 3, dos mais graves para os menos graves.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mostrar mais problemas" }));
    const link = await screen.findByRole("link", { name: "Ver o problema no elemento aside img" });
    expect(link).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Mostrar mais problemas" })).not.toBeInTheDocument();
    expect(screen.getByText("Mostrando 3 de 3, dos mais graves para os menos graves.")).toBeInTheDocument();
    expect(api.calls(FINDINGS).at(-1)!.searchParams.get("cursor")).toBe("c1");
  });

  it("RF-RA017: aba Aprovados lista cada regra com o selo 'Aprovado', vai para a URL, e nada diz que a página é acessível", async () => {
    stub();
    const { router, container } = await open();
    await userEvent.click(screen.getByRole("tab", { name: "Aprovados 2" }));
    expect(router.state.location.search).toBe("?aba=aprovados");
    const panel = screen.getByRole("tabpanel", { name: "Aprovados 2" });
    const list = within(panel).getByRole("list", { name: "Regras aprovadas" });
    const rules = within(list).getAllByRole("listitem");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toHaveTextContent("Aprovado");
    expect(rules[0]).toHaveTextContent("Images must have alternative text");
    expect(rules[0]).toHaveTextContent("image-alt · WCAG 1.1.1 · Em 1 elemento");
    expect(rules[0]!.querySelector('[lang="en"]')).toHaveTextContent("Images must have alternative text");
    expect(panel).toHaveTextContent('"Aprovado" vale para cada regra, não para a página inteira.');
    expect(document.body).not.toHaveTextContent(/acessível|conforme/i);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("RF-RA017: teclado nas abas (setas trocam de aba)", async () => {
    stub();
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Problemas 4" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Aprovados 2" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Aprovados 2" })).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    [null, "As verificações aprovadas não foram coletadas"],
    [[], "Nenhuma regra passou nesta página"],
  ] as const)("RF-RA017: passed_rules %j mostra o estado certo", async (rules, title) => {
    stub({ detail: { ...page, passed_rules: rules as PageDetail["passed_rules"], passed_count: rules === null ? null : 0 } });
    await open(`${PATH}?aba=aprovados`);
    expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
  });

  it("RF-RA028: página com barreira de login mostra o aviso com ícone e o texto do PRD", async () => {
    stub({ detail: { ...page, login_wall: true, url: "https://exemplo.com.br/painel", final_url: "https://exemplo.com.br/entrar" } });
    await open();
    const notice = screen
      .getByText("Esta página pede login. O Rampa auditou a tela de entrada; áreas logadas ainda não são cobertas.")
      .closest(".rp-notice")!;
    expect(notice.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("Redirecionada para", { exact: false })).toHaveTextContent("https://exemplo.com.br/entrar");
  });

  it("página com falha: o motivo da API (RF-RA029), sem abas", async () => {
    stub({
      detail: {
        ...page,
        status: "failed",
        http_status: 404,
        error: { code: "http_error", http_status: 404, message: "A página não foi encontrada (HTTP 404). Confira o endereço." },
        passed_rules: null,
      },
    });
    const { container } = await open();
    expect(screen.getByRole("region", { name: "Erro: Esta página não foi analisada" })).toHaveTextContent(
      "A página não foi encontrada (HTTP 404). Confira o endereço.",
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("página sem problemas: diz isso em texto, sem selo de aprovado para a página", async () => {
    stub({
      detail: { ...page, counts_by_severity: zero, needs_review_count: 0 },
      findings: () => jsonResponse({ data: [], next_cursor: null, total: 0 }),
    });
    await open();
    expect(screen.getByText("Sem problemas confirmados pela verificação automática")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Nenhum problema nesta página" })).toHaveTextContent(
      "Isso não garante que a página não tenha barreiras.",
    );
  });

  it("404 da página: mensagem da API e volta para a lista de páginas", async () => {
    stubApi({
      [`/api/audits/${AUDIT_ID}`]: auditSummary({ status: "completed" }),
      [`/api/audits/${AUDIT_ID}/pages/${PAGE_ID}`]: () =>
        apiError(404, "page_not_found", "Esta página não faz parte da auditoria. Volte à lista de páginas."),
    });
    renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Página não encontrada na auditoria" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Esta página não faz parte da auditoria.");
    expect(screen.getByRole("link", { name: "Voltar para as páginas" })).toHaveAttribute("href", `/auditorias/${AUDIT_ID}/paginas`);
  });

  it("depois de 'Mostrar mais', uma nova busca não rouba o foco de outro controle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let round = 0;
    stubApi({
      // Auditoria em andamento: a lista é buscada de novo a cada 5 s.
      [`/api/audits/${AUDIT_ID}`]: auditSummary({ status: "running" }),
      [`/api/audits/${AUDIT_ID}/pages/${PAGE_ID}`]: page,
      [FINDINGS]: (url: URL) => {
        round += 1;
        return url.searchParams.get("cursor") === "c1"
          ? jsonResponse({ data: [finding({ id: fid(9), selector: `aside img ${round}` })], next_cursor: null, total: null })
          : jsonResponse({ data: items.slice(0, 2), next_cursor: "c1", total: 3 });
      },
    });
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Mostrar mais problemas" }));
    await vi.waitFor(() => expect(document.activeElement?.textContent).toMatch(/aside img/));

    const apply = screen.getByRole("button", { name: "Filtrar" });
    apply.focus();
    const before = round;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100));
    await vi.waitFor(() => expect(round).toBeGreaterThan(before));
    expect(apply).toHaveFocus();
  });

  it("auditoria em andamento: a página é buscada de novo e mostra o resultado novo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let detail: PageDetail = { ...page, status: "scanning", counts_by_severity: zero, needs_review_count: 0 };
    let status: "running" | "completed" = "running";
    stubApi({
      [`/api/audits/${AUDIT_ID}`]: () => jsonResponse(auditSummary({ status })),
      [`/api/audits/${AUDIT_ID}/pages/${PAGE_ID}`]: () => jsonResponse(detail),
      [FINDINGS]: () => jsonResponse({ data: items, next_cursor: null, total: items.length }),
    });
    await open();
    expect(screen.getByRole("region", { name: "Esta página ainda está em análise" })).toBeInTheDocument();
    detail = page;
    status = "completed";
    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS));
    expect(await screen.findByRole("tab", { name: "Problemas 4" })).toBeInTheDocument();
    expect(screen.queryByText(/A auditoria ainda está em andamento/)).not.toBeInTheDocument();
  });
});
