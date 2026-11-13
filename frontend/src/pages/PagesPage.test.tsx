import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiError, stubApi } from "../../test/api";
import { AUDIT_ID, auditSummary, pageSummary } from "../../test/fixtures";
import { axeViolations, jsonResponse, renderRoute } from "../../test/render";
import { LIVE_REFRESH_MS } from "../report";

const PATH = `/auditorias/${AUDIT_ID}/paginas`;
const zero = { critical: 0, serious: 0, moderate: 0, minor: 0 };
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

const pages = [
  pageSummary({ id: A, url: "https://exemplo.com.br/a", title: "Agenda", counts_by_severity: { ...zero, serious: 3 } }),
  pageSummary({
    id: B,
    url: "https://exemplo.com.br/painel",
    final_url: "https://exemplo.com.br/entrar",
    title: "Entrar",
    counts_by_severity: { ...zero, critical: 1, minor: 2 },
    needs_review_count: 2,
    login_wall: true,
  }),
  pageSummary({
    id: C,
    url: "https://exemplo.com.br/sumiu",
    final_url: null,
    title: null,
    status: "failed",
    http_status: 404,
    error: { code: "http_error", http_status: 404, message: "A página não foi encontrada (HTTP 404). Confira o endereço." },
    scanned_at: null,
  }),
];

// Severidade dos achados para confirmar de cada página (os totais da página não dizem).
let reviewSeverities: Record<string, string[]> = { [B]: ["minor", "minor"] };

/** `GET /findings` com `limit` 1: o `total` de achados para confirmar daquela severidade. */
function findingsTotal(url: URL) {
  const list = reviewSeverities[url.searchParams.get("page_id") ?? ""] ?? [];
  const total = list.filter((s) => s === url.searchParams.get("severity")).length;
  return jsonResponse({ data: [], next_cursor: null, total });
}

function stub(extra: Record<string, unknown> = {}) {
  return stubApi({
    [`/api/audits/${AUDIT_ID}`]: auditSummary({ status: "completed", pages_found: 3, pages_scanned: 2, pages_failed: 1 }),
    [`/api/audits/${AUDIT_ID}/pages`]: { data: pages },
    [`/api/audits/${AUDIT_ID}/findings`]: findingsTotal,
    ...extra,
  });
}

const list = () => screen.getByRole("list", { name: "Páginas da auditoria" });
const items = () => within(list()).getAllByRole("listitem");
const names = () => items().map((li) => within(li).getAllByRole("link")[0]!.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  reviewSeverities = { [B]: ["minor", "minor"] };
});

describe("Páginas da auditoria (RF-RA006)", () => {
  it("lista URL, título, status e totais por severidade, com trilha e h1 igual ao título", async () => {
    stub();
    const { container } = renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Páginas auditadas em exemplo.com.br" })).toBeInTheDocument();
    expect(document.title).toBe("Páginas auditadas em exemplo.com.br – Rampa");
    const crumbs = screen.getByRole("navigation", { name: "Você está em" });
    expect(within(crumbs).getByRole("link", { name: "Relatório de exemplo.com.br" })).toHaveAttribute("href", `/auditorias/${AUDIT_ID}`);
    expect(within(crumbs).getByText("Páginas")).toHaveAttribute("aria-current", "page");

    // Mais graves primeiro: crítico, depois sérios, depois a que falhou.
    expect(names()).toEqual(["Entrar", "Agenda", "/sumiu"]);
    const [entrar, agenda, sumiu] = items();
    expect(entrar).toHaveTextContent("https://exemplo.com.br/entrar");
    expect(entrar).toHaveTextContent("Analisada");
    expect(entrar).toHaveTextContent("Pede login");
    expect(entrar).toHaveTextContent("1 crítico");
    expect(entrar).toHaveTextContent("2 menores");
    expect(entrar).toHaveTextContent("2 a confirmar");
    expect(agenda).toHaveTextContent("3 sérios");
    expect(agenda).not.toHaveTextContent("Pede login");
    expect(sumiu).toHaveTextContent("Com falha");
    expect(sumiu).toHaveTextContent("A página não foi encontrada (HTTP 404). Confira o endereço.");
    expect(within(entrar!).getByRole("link", { name: "Entrar" })).toHaveAttribute("href", `/auditorias/${AUDIT_ID}/paginas/${B}`);
    expect(screen.getByRole("status")).toHaveTextContent("3 de 3 páginas");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("filtros e ordem vão para a URL, a contagem é anunciada sem mover o foco e o link leva os filtros", async () => {
    stub();
    const { router } = renderRoute(PATH);
    await screen.findByRole("list", { name: "Páginas da auditoria" });
    const severity = screen.getByRole("combobox", { name: "Severidade" });
    await userEvent.selectOptions(severity, "serio");
    expect(router.state.location.search).toBe("?severidade=serio");
    expect(names()).toEqual(["Agenda"]);
    expect(screen.getByRole("status")).toHaveTextContent("1 de 3 páginas");
    expect(severity).toHaveFocus();
    expect(screen.getByRole("link", { name: "Agenda" })).toHaveAttribute(
      "href",
      `/auditorias/${AUDIT_ID}/paginas/${A}?severidade=serio`,
    );

    await userEvent.selectOptions(severity, "");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Ordenar por" }), "endereco");
    expect(router.state.location.search).toBe("?ordem=endereco");
    expect(names()).toEqual(["Agenda", "Entrar", "/sumiu"]);
  });

  it("link compartilhado com filtro abre filtrado; filtro sem resultado explica e oferece limpar", async () => {
    stub();
    const { router, container } = renderRoute(`${PATH}?severidade=moderado&revisao=sim`);
    expect(await screen.findByRole("region", { name: "Nenhuma página com esses filtros" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Severidade" })).toHaveValue("moderado");
    expect(screen.getByRole("combobox", { name: "Confirmação manual" })).toHaveValue("sim");
    expect(screen.getByRole("status")).toHaveTextContent("0 de 3 páginas");
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(router.state.location.search).toBe("");
    expect(names()).toHaveLength(3);
  });

  it("filtro de revisão mostra só as páginas com achados para confirmar", async () => {
    stub();
    renderRoute(`${PATH}?revisao=sim`);
    await screen.findByRole("list", { name: "Páginas da auditoria" });
    expect(names()).toEqual(["Entrar"]);
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", `/auditorias/${AUDIT_ID}/paginas/${B}?revisao=sim`);
  });

  it("404 da auditoria: mensagem da API e caminho para uma nova auditoria", async () => {
    const notFound = () => apiError(404, "audit_not_found", "Auditoria não encontrada. Confira o endereço do relatório.");
    stubApi({ [`/api/audits/${AUDIT_ID}`]: notFound, [`/api/audits/${AUDIT_ID}/pages`]: notFound });
    renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Auditoria não encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Auditoria não encontrada. Confira o endereço do relatório.");
    expect(screen.getByRole("link", { name: "Fazer uma nova auditoria" })).toHaveAttribute("href", "/");
  });

  it("erro da API (rede ou 5xx): mensagem e 'Tentar de novo', que busca outra vez", async () => {
    let fail = true;
    const api = stubApi({
      [`/api/audits/${AUDIT_ID}`]: auditSummary({ status: "completed" }),
      [`/api/audits/${AUDIT_ID}/pages`]: () =>
        fail ? apiError(500, "internal_error", "Ocorreu um erro inesperado. Tente de novo em alguns instantes.") : new Response(JSON.stringify({ data: pages }), { headers: { "Content-Type": "application/json" } }),
    });
    renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Não conseguimos carregar a auditoria" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Ocorreu um erro inesperado.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Páginas auditadas em exemplo.com.br" })).toBeInTheDocument();
    expect(api.calls(`/api/audits/${AUDIT_ID}/pages`)).toHaveLength(2);
  });

  it("auditoria em andamento: avisa que a lista pode mudar e leva ao progresso", async () => {
    stub({ [`/api/audits/${AUDIT_ID}`]: auditSummary({ status: "running" }) });
    renderRoute(PATH);
    await screen.findByRole("list", { name: "Páginas da auditoria" });
    expect(screen.getByText(/A auditoria ainda está em andamento/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acompanhar o andamento" })).toHaveAttribute("href", `/auditorias/${AUDIT_ID}`);
  });

  it("carregando: h1 desde o primeiro quadro", () => {
    stubApi({
      [`/api/audits/${AUDIT_ID}`]: () => new Promise<Response>(() => undefined),
      [`/api/audits/${AUDIT_ID}/pages`]: () => new Promise<Response>(() => undefined),
    });
    renderRoute(PATH);
    expect(screen.getByRole("heading", { level: 1, name: "Carregando as páginas" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando as páginas…");
  });

  it("review: página com 2 críticos só para confirmar entra no filtro de críticos, como o filtro da API na página", async () => {
    const R = "dddddddd-0000-4000-8000-000000000004";
    reviewSeverities = { [R]: ["critical", "critical"] };
    const api = stub({
      [`/api/audits/${AUDIT_ID}/pages`]: {
        data: [pageSummary({ id: R, title: "Revisão", url: "https://exemplo.com.br/r", counts_by_severity: zero, needs_review_count: 2 })],
      },
    });
    renderRoute(`${PATH}?severidade=critico`);
    expect(await screen.findByRole("link", { name: "Revisão" })).toHaveAttribute(
      "href",
      `/auditorias/${AUDIT_ID}/paginas/${R}?severidade=critico`,
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 de 1 página");
    expect(Object.fromEntries(api.calls(`/api/audits/${AUDIT_ID}/findings`)[0]!.searchParams)).toEqual({
      page_id: R,
      severity: "critical",
      needs_review: "true",
      limit: "1",
    });
  });

  it("review: 1 crítico confirmado + 1 moderado para confirmar, com severidade=critico&revisao=sim, não aparece", async () => {
    const M = "eeeeeeee-0000-4000-8000-000000000005";
    reviewSeverities = { [M]: ["moderate"] };
    stub({
      [`/api/audits/${AUDIT_ID}/pages`]: {
        data: [pageSummary({ id: M, title: "Mista", counts_by_severity: { ...zero, critical: 1 }, needs_review_count: 1 })],
      },
    });
    renderRoute(`${PATH}?severidade=critico&revisao=sim`);
    expect(await screen.findByRole("region", { name: "Nenhuma página com esses filtros" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mista" })).not.toBeInTheDocument();
  });

  it("auditoria em andamento: a lista é buscada de novo a cada 5 s e para quando ela termina", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status: "running" | "completed" = "running";
    let current = [pageSummary({ id: A, title: "Agenda", status: "scanning", counts_by_severity: zero })];
    const api = stubApi({
      [`/api/audits/${AUDIT_ID}`]: () => jsonResponse(auditSummary({ status })),
      [`/api/audits/${AUDIT_ID}/pages`]: () => jsonResponse({ data: current }),
    });
    renderRoute(PATH);
    expect(await screen.findByText("Em análise")).toBeInTheDocument();

    current = [pageSummary({ id: A, title: "Agenda", counts_by_severity: { ...zero, serious: 3 } })];
    status = "completed";
    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS));
    await vi.waitFor(() => expect(items()[0]).toHaveTextContent("3 sérios"));
    expect(screen.queryByText(/A auditoria ainda está em andamento/)).not.toBeInTheDocument();

    const gets = api.calls(`/api/audits/${AUDIT_ID}/pages`).length;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3));
    expect(api.calls(`/api/audits/${AUDIT_ID}/pages`).length).toBe(gets);
  });

  it("auditoria concluída: nada é buscado de novo sozinho", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = stub();
    renderRoute(PATH);
    await screen.findByRole("list", { name: "Páginas da auditoria" });
    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3));
    expect(api.calls(`/api/audits/${AUDIT_ID}/pages`)).toHaveLength(1);
  });
});
