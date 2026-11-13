import { screen, within } from "@testing-library/react";
import { apiError, stubApi } from "../../test/api";
import { AUDIT_ID, FINDING_ID, PAGE_ID, auditSummary, findingDetail } from "../../test/fixtures";
import { axeViolations, renderRoute } from "../../test/render";
import type { FindingDetail } from "../api/types";

const PATH = `/auditorias/${AUDIT_ID}/problemas/${FINDING_ID}`;
const OTHER = "99999999-0000-4000-8000-000000000009";

function stub(detail: FindingDetail | (() => Response)) {
  return stubApi({
    [`/api/audits/${AUDIT_ID}`]: auditSummary({ status: "completed" }),
    [`/api/audits/${AUDIT_ID}/findings/${FINDING_ID}`]: detail,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Detalhe do problema (RF-RA007, parte do M2)", () => {
  it("achado do axe: severidade com ícone e texto, critério, origem, seletor, trecho, ocorrências e como corrigir", async () => {
    stub(
      findingDetail({
        occurrences: { page: 2, audit: 5 },
        other_pages: [{ page_id: OTHER, url: "https://exemplo.com.br/contato", title: "Contato", occurrences: 3 }],
      }),
    );
    const { container } = renderRoute(PATH);
    const h1 = await screen.findByRole("heading", { level: 1, name: "Images must have alternative text" });
    expect(h1).toHaveAttribute("lang", "en");
    expect(document.title).toBe("Images must have alternative text – Rampa");

    const crumbs = screen.getByRole("navigation", { name: "Você está em" });
    expect(within(crumbs).getAllByRole("link").map((a) => a.textContent)).toEqual(["Relatório de exemplo.com.br", "Páginas", "Início"]);
    expect(within(crumbs).getByText("Problema")).toHaveAttribute("aria-current", "page");

    const stat = (term: string) => screen.getByText(term, { selector: "dt" }).nextElementSibling;
    expect(stat("Nesta página")).toHaveTextContent("2 vezes");
    expect(stat("Na auditoria")).toHaveTextContent("5 vezes");

    expect(screen.getByRole("heading", { level: 2, name: "Código encontrado" })).toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent('<img src="mapa.png">');

    const aside = screen.getByRole("complementary", { name: "Detalhes do problema" });
    expect(aside).toHaveTextContent("Crítico");
    expect(aside).toHaveTextContent("WCAG 1.1.1");
    expect(aside).toHaveTextContent("Automática (axe-core 4.11.0, regra image-alt)");
    expect(within(aside).getByText("main > img").tagName).toBe("CODE");
    expect(within(aside).getByRole("link", { name: "Início" })).toHaveAttribute("href", `/auditorias/${AUDIT_ID}/paginas/${PAGE_ID}`);
    const elsewhere = within(aside).getByRole("region", { name: "Onde mais aparece" });
    expect(within(elsewhere).getByRole("link", { name: "Contato" })).toHaveAttribute("href", `/auditorias/${AUDIT_ID}/paginas/${OTHER}`);
    expect(elsewhere).toHaveTextContent("3 vezes");

    const fix = screen.getByRole("region", { name: "Como corrigir" });
    expect(fix.querySelector('[lang="en"]')).toHaveTextContent("Element does not have an alt attribute");
    expect(within(fix).getByRole("link", { name: /Regra image-alt na documentação do axe-core \(em inglês\)/ })).toHaveAttribute(
      "href",
      "https://dequeuniversity.com/rules/axe/4.11/image-alt",
    );
    // "Quem é afetado" em PT-BR é do M3: sem o texto da API, a seção não aparece vazia.
    expect(screen.queryByRole("region", { name: "Quem é afetado" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Avaliado por IA/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("achado da IA: selo 'Avaliado por IA, confirme manualmente', confiança, justificativa e sugestão", async () => {
    stub(
      findingDetail({
        source: "ai",
        rule_id: "rampa-alt-inadequate",
        help: null,
        needs_review: true,
        confidence: 0.86,
        ai_reason: "O texto alternativo diz só \"foto\".",
        ai_suggestion: "Mapa dos postos de vacinação.",
        ai_model: "claude-x",
        help_url: null,
        message: null,
        who_is_affected: "Pessoas que usam leitor de tela.",
        how_to_fix: "Descreva o que a imagem comunica.",
      }),
    );
    const { container } = renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Regra rampa-alt-inadequate" })).not.toHaveAttribute("lang");
    expect(screen.getAllByText("Avaliado por IA, confirme manualmente")).toHaveLength(1);
    expect(screen.getByText("Confiança alta (86%)")).toBeInTheDocument();
    const ai = screen.getByRole("region", { name: "Avaliação da IA" });
    expect(ai).toHaveTextContent("O texto alternativo diz só \"foto\".");
    expect(ai).toHaveTextContent("Mapa dos postos de vacinação.");
    expect(screen.getByRole("region", { name: "Quem é afetado" })).toHaveTextContent("Pessoas que usam leitor de tela.");
    expect(screen.getByRole("region", { name: "Como corrigir" })).toHaveTextContent("Descreva o que a imagem comunica.");
    expect(screen.getByRole("complementary")).toHaveTextContent("Avaliação por IA (claude-x)");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("achado do axe que pede revisão (incomplete): 'O axe não conseguiu decidir'", async () => {
    stub(findingDetail({ needs_review: true, rule_id: "color-contrast", help: "Elements must meet minimum color contrast ratio thresholds" }));
    renderRoute(PATH);
    expect(await screen.findByText("O axe não conseguiu decidir: confirme manualmente")).toBeInTheDocument();
  });

  it("sem trecho de código nem seletor: diz isso em texto", async () => {
    stub(findingDetail({ html_snippet: null, selector: null }));
    renderRoute(PATH);
    expect(await screen.findByText("O trecho de código deste elemento não foi guardado.")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toHaveTextContent("Elemento sem seletor");
  });

  it("404 do achado: mensagem da API e volta para as páginas", async () => {
    stub(() => apiError(404, "finding_not_found", "Este problema não faz parte da auditoria. Volte à lista de problemas."));
    renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Problema não encontrado na auditoria" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Este problema não faz parte da auditoria.");
    expect(screen.getByRole("link", { name: "Voltar para as páginas" })).toBeInTheDocument();
  });

  it("404 da auditoria: título de auditoria não encontrada", async () => {
    stub(() => apiError(404, "audit_not_found", "Auditoria não encontrada. Confira o endereço do relatório."));
    renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Auditoria não encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fazer uma nova auditoria" })).toHaveAttribute("href", "/");
  });
});
