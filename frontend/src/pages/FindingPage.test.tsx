import { screen, within } from "@testing-library/react";
import { apiError, stubApi, type Handler } from "../../test/api";
import {
  AUDIT_ID,
  EMAG_URL,
  FINDING_ID,
  PAGE_ID,
  WCAG_CRITERIA_PATH,
  auditSummary,
  findingDetail,
  pageSummary,
  wcagCatalog,
} from "../../test/fixtures";
import { axeViolations, jsonResponse, renderRoute } from "../../test/render";
import type { FindingDetail } from "../api/types";
import { CATALOG_WAIT_MS } from "./FindingPage";

const PATH = `/auditorias/${AUDIT_ID}/problemas/${FINDING_ID}`;
const OTHER = "99999999-0000-4000-8000-000000000009";

/** Sem `catalog`, o caminho do catálogo não responde (falha de rede): a tela fica como no M2. */
function stub(detail: FindingDetail | (() => Response), catalog?: Handler) {
  return stubApi({
    ...(catalog === undefined ? {} : { [WCAG_CRITERIA_PATH]: catalog }),
    [`/api/audits/${AUDIT_ID}`]: auditSummary({ status: "completed" }),
    [`/api/audits/${AUDIT_ID}/findings/${FINDING_ID}`]: detail,
    [`/api/audits/${AUDIT_ID}/pages`]: {
      data: [
        pageSummary(),
        pageSummary({ id: OTHER, url: "https://exemplo.com.br/contato", final_url: "https://exemplo.com.br/fale-conosco" }),
      ],
    },
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
    // O endereço exibido é o final, como no resto do relatório.
    await vi.waitFor(() => expect(elsewhere).toHaveTextContent("https://exemplo.com.br/fale-conosco · 3 vezes"));

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

  it("erro ao carregar o achado (500): mensagem da API e 'Tentar de novo', sem esperar o catálogo", async () => {
    stub(() => apiError(500, "internal_error", "Ocorreu um erro inesperado. Tente de novo em alguns instantes."));
    renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Não conseguimos carregar a auditoria" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  it("404 da auditoria: título de auditoria não encontrada", async () => {
    stub(() => apiError(404, "audit_not_found", "Auditoria não encontrada. Confira o endereço do relatório."));
    renderRoute(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Auditoria não encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fazer uma nova auditoria" })).toHaveAttribute("href", "/");
  });
});

// --- Critérios WCAG e eMAG (RF-RA007, M3) ---------------------------------------------------

const region = (name: string) => screen.getByRole("region", { name });
const criteriaRegion = () => region("Critérios relacionados");
const aside = () => screen.getByRole("complementary", { name: "Detalhes do problema" });
const asideCriteria = () => within(aside()).getByText("Critérios", { selector: "dt" }).nextElementSibling;

async function openWithCatalog(overrides: Partial<FindingDetail>, catalog: Handler = wcagCatalog()) {
  stub(findingDetail(overrides), catalog);
  const view = renderRoute(PATH);
  await screen.findByRole("heading", { level: 2, name: "Código encontrado" });
  return view;
}

/** Um bloco de critério da seção, pelo h3. */
function criterionBlock(name: string) {
  return within(criteriaRegion()).getByRole("heading", { level: 3, name }).parentElement!;
}

describe("Critérios WCAG e eMAG no detalhe (RF-RA007, M3)", () => {
  it("CA1.1, CA3.1: critério 1.1.1 com número, título, nível, resumo, link da W3C e a recomendação 3.6 do eMAG com um link", async () => {
    const { container } = await openWithCatalog({});
    const section = criteriaRegion();
    // Depois de "Como corrigir".
    expect(region("Como corrigir").compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section).toHaveTextContent("Este problema está relacionado ao critério da WCAG 2.2 abaixo");

    const block = criterionBlock("1.1.1 Conteúdo Não Textual");
    expect(block).toHaveTextContent("Nível A");
    expect(block).toHaveTextContent("Imagens que transmitem informação têm um texto equivalente.");
    expect(within(block).getByRole("link", { name: /^Critério 1\.1\.1 na WCAG 2\.2 em português \(W3C\)/ })).toHaveAttribute(
      "href",
      "https://www.w3.org/Translations/WCAG22-pt-BR/#non-text-content",
    );
    expect(within(block).getByRole("heading", { level: 4, name: "Recomendações do eMAG que citam o critério 1.1.1" })).toBeInTheDocument();
    expect(within(block).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "3.6 Fornecer alternativa em texto para as imagens do sítio",
    ]);
    const emagLinks = within(section).getAllByRole("link").filter((a) => a.getAttribute("href") === EMAG_URL);
    expect(emagLinks).toHaveLength(1);
    expect(emagLinks[0]).toHaveAccessibleName("Documento do eMAG 3.1 (Governo Federal) (abre em nova aba)");
    expect(emagLinks[0]).toHaveAttribute("target", "_blank");
    expect(section).toHaveTextContent(
      "Títulos da tradução autorizada da WCAG 2.2 (W3C). Recomendações do eMAG 3.1 (Governo Federal, CC BY 4.0).",
    );
    // FR-011: o problema está "relacionado"; nada de cumprir, falhar ou conformidade.
    expect(section.textContent).not.toMatch(/cumpre|conforme|conformidade|falha o critério|é acessível/i);
    // CA1.3 (lateral) e hierarquia de títulos sem pular nível.
    expect(asideCriteria()).toHaveTextContent("1.1.1 Conteúdo Não Textual");
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => expect(level - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1));
    expect(await axeViolations(container)).toEqual([]);
  });

  it("CA1.2: dois critérios, cada um com número, nível, título, resumo e link, em ordem numérica", async () => {
    await openWithCatalog({ wcag_criteria: ["1.4.3", "1.1.1"] });
    const section = criteriaRegion();
    expect(within(section).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "1.1.1 Conteúdo Não Textual",
      "1.4.3 Contraste (Mínimo)",
    ]);
    expect(section).toHaveTextContent("relacionado aos 2 critérios da WCAG 2.2");
    const contrast = criterionBlock("1.4.3 Contraste (Mínimo)");
    expect(contrast).toHaveTextContent("Nível AA");
    expect(contrast).toHaveTextContent("Texto tem contraste mínimo de 4,5:1 com o fundo.");
    expect(within(contrast).getByRole("link", { name: /^Critério 1\.4\.3 na WCAG 2\.2 em português/ })).toHaveAttribute(
      "href",
      "https://www.w3.org/Translations/WCAG22-pt-BR/#contrast-minimum",
    );
    expect(asideCriteria()).toHaveTextContent("1.1.1 Conteúdo Não Textual; 1.4.3 Contraste (Mínimo)");
  });

  it("CA1.6: região rolável ligada a 2.1.1 e 2.1.3, os dois com título e o 2.1.3 com 'Nível AAA'", async () => {
    await openWithCatalog({ rule_id: "scrollable-region-focusable", wcag_criteria: ["2.1.3", "2.1.1"] });
    expect(criterionBlock("2.1.1 Teclado")).toHaveTextContent("Nível A");
    expect(criterionBlock("2.1.3 Teclado (Sem Exceção)")).toHaveTextContent("Nível AAA");
  });

  it("CA1.4: achado sem critério WCAG: 'Sem critério WCAG associado', sem seção de critérios nem link quebrado", async () => {
    const { container } = await openWithCatalog({ wcag_criteria: [] });
    expect(asideCriteria()).toHaveTextContent("Sem critério WCAG associado");
    expect(screen.queryByRole("region", { name: "Critérios relacionados" })).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="w3.org"], a[href*="emag"]')).toBeNull();
  });

  it("CA1.5: critério fora do catálogo (4.1.1) aparece só com o número, sem título, nível nem link inventados", async () => {
    const { container } = await openWithCatalog({ wcag_criteria: ["4.1.1"] });
    expect(asideCriteria()).toHaveTextContent("WCAG 4.1.1");
    expect(screen.queryByRole("region", { name: "Critérios relacionados" })).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="w3.org"]')).toBeNull();
    expect(document.body).not.toHaveTextContent(/Nível/);
  });

  it("CA1.5: com um critério conhecido e outro fora do catálogo, a seção traz só o conhecido e a lateral, os dois", async () => {
    await openWithCatalog({ wcag_criteria: ["4.1.1", "1.1.1"] });
    expect(within(criteriaRegion()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "1.1.1 Conteúdo Não Textual",
    ]);
    expect(asideCriteria()).toHaveTextContent("1.1.1 Conteúdo Não Textual; WCAG 4.1.1");
  });

  it("CA2.1: 'Quem é afetado' do critério 1.4.3 em português, sem a mensagem do axe em inglês", async () => {
    await openWithCatalog({
      rule_id: "color-contrast",
      wcag_criteria: ["1.4.3"],
      message: "Fix any of the following:\n  Element has insufficient color contrast",
    });
    const who = region("Quem é afetado");
    expect(who).toHaveTextContent("Pessoas com baixa visão têm dificuldade para ler texto claro sobre fundo claro.");
    expect(who).not.toHaveTextContent(/insufficient|Fix any/);
    expect(who.querySelector('[lang="en"]')).toBeNull();
    // A mensagem do axe continua em "Como corrigir".
    expect(region("Como corrigir")).toHaveTextContent("Element has insufficient color contrast");
  });

  it("CA2.2: dois critérios: o texto de cada um, identificado pelo número e pelo título", async () => {
    const { container } = await openWithCatalog({ wcag_criteria: ["1.4.3", "1.1.1"] });
    const who = region("Quem é afetado");
    expect(within(who).getAllByRole("term").map((dt) => dt.textContent)).toEqual([
      "1.1.1 Conteúdo Não Textual",
      "1.4.3 Contraste (Mínimo)",
    ]);
    expect(within(who).getAllByRole("definition").map((dd) => dd.textContent)).toEqual([
      "Pessoas cegas que usam leitor de tela ouvem o texto alternativo no lugar da imagem.",
      "Pessoas com baixa visão têm dificuldade para ler texto claro sobre fundo claro.",
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("CA2.3: sem critério conhecido e sem texto do achado, a seção 'Quem é afetado' não aparece", async () => {
    await openWithCatalog({ wcag_criteria: ["4.1.1"], who_is_affected: null });
    expect(screen.queryByRole("region", { name: "Quem é afetado" })).not.toBeInTheDocument();
  });

  it("CA2.5: o texto de impacto do próprio achado vence os dos critérios", async () => {
    await openWithCatalog({ source: "ai", wcag_criteria: ["1.1.1"], who_is_affected: "Quem não vê o mapa perde os endereços." });
    const who = region("Quem é afetado");
    expect(who).toHaveTextContent("Quem não vê o mapa perde os endereços.");
    expect(who).not.toHaveTextContent("Pessoas cegas que usam leitor de tela");
    expect(within(who).queryByRole("term")).not.toBeInTheDocument();
  });

  it("CA3.2: critério da WCAG 2.2 sem eMAG diz que o eMAG é anterior; critério da 2.0 sem citação diz que nenhuma o cita", async () => {
    await openWithCatalog({ wcag_criteria: ["2.5.8", "1.4.5"] });
    const newer = criterionBlock("2.5.8 Tamanho do Alvo (Mínimo)");
    expect(newer).toHaveTextContent("O eMAG 3.1 (2014) é anterior a este critério e não o cita.");
    expect(within(newer).queryByRole("list")).not.toBeInTheDocument();
    const older = criterionBlock("1.4.5 Imagens de Texto");
    expect(older).toHaveTextContent("Nenhuma recomendação do eMAG 3.1 cita este critério.");
    expect(within(criteriaRegion()).queryAllByRole("link").filter((a) => a.getAttribute("href") === EMAG_URL)).toHaveLength(0);
  });

  it("CA3.3: critério citado por mais de uma recomendação: todas, em ordem numérica (3.9 antes de 3.10)", async () => {
    await openWithCatalog({ wcag_criteria: ["1.4.3"] });
    const block = criterionBlock("1.4.3 Contraste (Mínimo)");
    expect(within(block).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "3.9 Recomendação de teste nove",
      "3.10 Recomendação de teste dez",
    ]);
  });

  it("CA3.4: a primeira menção ao eMAG na tela vem por extenso, uma vez só", async () => {
    await openWithCatalog({ wcag_criteria: ["2.5.8", "1.1.1"] });
    const text = document.body.textContent ?? "";
    const full = "Modelo de Acessibilidade em Governo Eletrônico (eMAG)";
    expect(text.indexOf("eMAG")).toBe(text.indexOf(full) + full.indexOf("eMAG"));
    expect(text.split(full)).toHaveLength(2);
  });

  it("catálogo com falha: a tela fica como no M2, sem mensagem de erro", async () => {
    const { container } = await openWithCatalog({}, () => apiError(500, "internal_error", "Erro."));
    expect(screen.queryByRole("region", { name: "Critérios relacionados" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Quem é afetado" })).not.toBeInTheDocument();
    expect(asideCriteria()).toHaveTextContent("WCAG 1.1.1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Erro\.|eMAG/);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("FR-017: o corpo do detalhe não muda de lugar depois de montado", () => {
  /** Registra, a cada mudança no DOM, se o corpo já está montado sem a seção de critérios. */
  function watchBodyWithoutCriteria() {
    const states: string[] = [];
    const observer = new MutationObserver(() => {
      const body = document.getElementById("codigo-encontrado") !== null;
      const criteria = document.getElementById("criterios-relacionados") !== null;
      states.push(body ? (criteria ? "corpo com critérios" : "corpo sem critérios") : "carregando");
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return { states, stop: () => observer.disconnect() };
  }

  it("catálogo que chega em 1 s: o corpo espera e já monta com a seção, sem inseri-la depois", async () => {
    stub(findingDetail(), () => new Promise<Response>((resolve) => setTimeout(() => resolve(jsonResponse(wcagCatalog())), 1000)));
    const watch = watchBodyWithoutCriteria();
    renderRoute(PATH);
    const loadingH1 = await screen.findByRole("heading", { level: 1, name: "Carregando o problema" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByRole("heading", { level: 2, name: "Código encontrado" })).not.toBeInTheDocument();
    expect(screen.getByText("Carregando o problema…")).toBeInTheDocument();

    await screen.findByRole("heading", { level: 2, name: "Critérios relacionados" }, { timeout: 2000 });
    watch.stop();
    expect(watch.states).not.toContain("corpo sem critérios");
    // O h1 é o mesmo elemento: o foco que o AppShell pôs nele não se perde.
    expect(screen.getByRole("heading", { level: 1 })).toBe(loadingH1);
    expect(loadingH1).toHaveTextContent("Images must have alternative text");
  });

  it(`sem catálogo em ${CATALOG_WAIT_MS} ms, monta como no M2; quando ele chega, nenhuma seção entra (só o rótulo da lateral muda)`, async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    stub(findingDetail(), async () => {
      await gate;
      return jsonResponse(wcagCatalog());
    });
    const started = Date.now();
    renderRoute(PATH);
    await screen.findByRole("heading", { level: 2, name: "Código encontrado" }, { timeout: CATALOG_WAIT_MS + 1500 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(CATALOG_WAIT_MS - 50);
    const headings = () => screen.getAllByRole("heading").map((h) => h.textContent);
    const before = headings();
    expect(before).not.toContain("Critérios relacionados");
    expect(asideCriteria()).toHaveTextContent("WCAG 1.1.1");

    release();
    await vi.waitFor(() => expect(asideCriteria()).toHaveTextContent("1.1.1 Conteúdo Não Textual"));
    expect(headings()).toEqual(before);
    expect(screen.queryByRole("region", { name: "Critérios relacionados" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Quem é afetado" })).not.toBeInTheDocument();
  });
});
