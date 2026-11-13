import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubApi } from "../../test/api";
import { FakeSocket } from "../../test/fakeSocket";
import { AUDIT_ID, FINDING_ID, auditSummary, progress } from "../../test/fixtures";
import { axeViolations, renderRoute } from "../../test/render";
import type { AuditSummary } from "../api/types";

const PATH = `/auditorias/${AUDIT_ID}`;
const zero = { critical: 0, serious: 0, moderate: 0, minor: 0 };
const NEW_ID = "11111111-2222-4333-8444-555555555555";

function completed(overrides: Partial<AuditSummary> = {}) {
  return auditSummary({
    status: "completed",
    pages_found: 1,
    pages_scanned: 1,
    finished_at: "2026-11-12T10:00:09Z",
    totals_by_severity: { ...zero, critical: 2, serious: 3, minor: 1 },
    needs_review_by_severity: { ...zero, serious: 4 },
    needs_review_count: 4,
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
      {
        rule_id: "color-contrast",
        help: null,
        wcag_criteria: [],
        severity: "serious",
        pages_affected: 1,
        occurrences: 3,
        sample_finding_id: "6f7a8b9c-0d1e-4f2a-b3c4-d5e6f7a8b9c0",
      },
    ],
    ...overrides,
  });
}

async function open(summary: AuditSummary, extra: Record<string, unknown> = {}) {
  const api = stubApi({ [`/api/audits/${AUDIT_ID}`]: summary, [`/api/audits/${AUDIT_ID}/pages`]: { data: [] }, ...extra });
  const view = renderRoute(PATH, { socket: new FakeSocket() });
  await screen.findByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" });
  await screen.findByText("Problemas confirmados");
  return { ...view, api };
}

afterEach(() => vi.unstubAllGlobals());

describe("Relatório resumido (RF-RA005)", () => {
  it("h1 igual ao título, aviso fixo, totais, tabela separando confirmados e para confirmar, top problemas, sem pontuação inventada", async () => {
    const { container } = await open(completed());
    expect(document.title).toBe("Relatório de exemplo.com.br – Rampa");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/^Auditado .* · 1 página analisada · WCAG 2.2 nível AA$/)).toBeInTheDocument();
    // Aviso fixo (RF-RA005), com ícone e texto.
    expect(
      screen.getByText(
        "A verificação automática não garante conformidade e não substitui a avaliação com pessoas e tecnologias assistivas.",
      ),
    ).toBeInTheDocument();

    const stat = (term: string) => screen.getByText(term, { selector: "dt" }).nextElementSibling;
    expect(stat("Problemas confirmados")).toHaveTextContent("6");
    expect(stat("Críticos")).toHaveTextContent("2");
    expect(stat("Para confirmar")).toHaveTextContent("4");
    expect(stat("Páginas analisadas")).toHaveTextContent("1");
    expect(screen.queryByText("Páginas com falha")).not.toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Problemas confirmados e para confirmar, por severidade" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Severidade",
      "Confirmados automaticamente",
      "Pedem confirmação manual",
    ]);
    const serious = within(table).getByRole("rowheader", { name: "Sério" }).closest("tr")!;
    expect(within(serious).getAllByRole("cell").map((td) => td.textContent)).toEqual(["3", "4"]);
    const total = within(table).getByRole("rowheader", { name: "Total" }).closest("tr")!;
    expect(within(total).getAllByRole("cell").map((td) => td.textContent)).toEqual(["6", "4"]);
    expect(screen.getByRole("region", { name: "Problemas confirmados e para confirmar, por severidade" })).toHaveAttribute(
      "tabindex",
      "0",
    );

    const top = screen.getByRole("heading", { level: 2, name: "Os problemas mais frequentes" }).closest("section")!;
    const items = within(top).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("heading", { level: 3 })).toHaveTextContent("1º: Images must have alternative text");
    expect(within(items[0]!).getByRole("heading", { level: 3 }).querySelector('[lang="en"]')).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("Crítico");
    expect(items[0]).toHaveTextContent("Em 1 página · 2 ocorrências · WCAG 1.1.1");
    expect(within(items[0]!).getByRole("link", { name: "Ver detalhes do problema Images must have alternative text" })).toHaveAttribute(
      "href",
      `/auditorias/${AUDIT_ID}/problemas/${FINDING_ID}`,
    );
    expect(within(items[1]!).getByRole("heading", { level: 3 })).toHaveTextContent("2º: Regra color-contrast");
    expect(items[1]).toHaveTextContent("Sem critério WCAG associado");
    expect(within(top).getByRole("link", { name: "Ver todos os problemas por página" })).toHaveAttribute(
      "href",
      `/auditorias/${AUDIT_ID}/paginas`,
    );

    const review = screen.getByRole("region", { name: "Achados que pedem confirmação" });
    expect(review).toHaveTextContent("4 achados pedem confirmação manual");
    expect(within(review).getByRole("link", { name: "Ver as páginas com achados para confirmar" })).toHaveAttribute(
      "href",
      `/auditorias/${AUDIT_ID}/paginas?revisao=sim`,
    );

    // §10.6 é do M3: com `score: null` não há número nem anel.
    expect(screen.queryByText("Indicador de problemas encontrados automaticamente")).not.toBeInTheDocument();
    expect(screen.queryByText("de 100")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auditar de novo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver páginas e problemas" })).toHaveAttribute("href", `/auditorias/${AUDIT_ID}/paginas`);
    // Sem barreira de login, sem aviso (RF-RA028 CA3).
    expect(screen.queryByText(/pede login/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/(é|está) (acessível|conforme)/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("RF-RA028: com barreira de login, o aviso aparece com ícone e o texto do PRD", async () => {
    await open(completed({ login_wall_pages: 1 }));
    const notice = screen
      .getByText("Esta página pede login. O Rampa auditou a tela de entrada; áreas logadas ainda não são cobertas.")
      .closest(".rp-notice")!;
    expect(notice.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("RF-RA028: várias páginas com login dizem quantas", async () => {
    await open(completed({ pages_found: 3, pages_scanned: 3, login_wall_pages: 2 }));
    expect(
      screen.getByText("2 páginas pedem login. O Rampa auditou as telas de entrada; áreas logadas ainda não são cobertas."),
    ).toBeInTheDocument();
  });

  it("sem problemas confirmados: o estado vazio não diz que o site é acessível e lembra da avaliação com pessoas", async () => {
    const { container } = await open(completed({ totals_by_severity: zero, needs_review_by_severity: zero, needs_review_count: 0, top_issues: [] }));
    const empty = screen.getByRole("region", { name: "A verificação automática não confirmou problemas" });
    expect(empty).toHaveTextContent("Isso não quer dizer que o site não tenha barreiras");
    expect(screen.queryByRole("region", { name: "Achados que pedem confirmação" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("com pontuação (M3), mostra o indicador com o rótulo do §10.6", async () => {
    await open(completed({ score: 72 }));
    expect(screen.getByText("Indicador de problemas encontrados automaticamente")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("páginas com falha numa auditoria concluída aparecem num card próprio", async () => {
    await open(completed({ pages_found: 3, pages_scanned: 2, pages_failed: 1 }));
    expect(screen.getByText("Páginas com falha", { selector: "dt" }).nextElementSibling).toHaveTextContent("1");
  });

  it("RF-RA029: 'Auditar de novo' no relatório concluído leva à nova auditoria", async () => {
    const { router, api } = await open(completed(), {
      "/api/audits": () => new Response(JSON.stringify({ id: NEW_ID }), { status: 202, headers: { "Content-Type": "application/json" } }),
      [`/api/audits/${NEW_ID}`]: auditSummary({ id: NEW_ID, status: "queued" }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Auditar de novo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Auditando exemplo.com.br" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/auditorias/${NEW_ID}`);
    expect(api.calls("/api/audits")).toHaveLength(1);
  });

  it("resumo em cache ainda em andamento, mas o canal diz que acabou: carrega o resumo concluído uma vez", async () => {
    let summary = auditSummary({ status: "running" });
    const api = stubApi({
      [`/api/audits/${AUDIT_ID}`]: () => new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } }),
      [`/api/audits/${AUDIT_ID}/pages`]: { data: [] },
    });
    const socket = new FakeSocket();
    renderRoute(PATH, { socket });
    await screen.findByRole("heading", { level: 1, name: "Auditando exemplo.com.br" });
    summary = completed();
    act(() => socket.last.reply({ revision: 5, progress: progress({ status: "completed", pages_scanned: 1 }) }));
    expect(await screen.findByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" })).toBeInTheDocument();
    expect(await screen.findByText("Problemas confirmados")).toBeInTheDocument();
    expect(api.calls(`/api/audits/${AUDIT_ID}`).length).toBeLessThanOrEqual(3);
  });
});
