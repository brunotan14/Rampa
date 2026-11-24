// Dados de exemplo nos formatos dos contratos (tipos gerados), para os testes.
import type {
  AuditSummary,
  ChannelProgress,
  Finding,
  FindingDetail,
  PageDetail,
  PageSummary,
  WcagCriteriaResponse,
  WcagCriterion,
} from "../src/api/types";

export const AUDIT_ID = "3f2b8c1e-7a4d-4e5f-9b0c-1d2e3f4a5b6c";
export const PAGE_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const zero = { critical: 0, serious: 0, moderate: 0, minor: 0 };

export function progress(overrides: Partial<ChannelProgress> = {}): ChannelProgress {
  return {
    status: "running",
    pages_found: 1,
    pages_scanned: 0,
    pages_failed: 0,
    totals_by_severity: zero,
    needs_review_count: 0,
    error: null,
    ...overrides,
  };
}

export function auditSummary(overrides: Partial<AuditSummary> = {}): AuditSummary {
  return {
    id: AUDIT_ID,
    status: "running",
    revision: 1,
    start_url: "https://exemplo.com.br/",
    page_limit: 1,
    pages_found: 1,
    pages_scanned: 0,
    pages_failed: 0,
    totals_by_severity: zero,
    needs_review_by_severity: zero,
    needs_review_count: 0,
    login_wall_pages: 0,
    score: null,
    top_issues: [],
    error: null,
    inserted_at: "2026-11-12T10:00:00Z",
    started_at: "2026-11-12T10:00:01Z",
    finished_at: null,
    ...overrides,
  };
}

export const FINDING_ID = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";

export function pageSummary(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: PAGE_ID,
    url: "https://exemplo.com.br/",
    final_url: "https://exemplo.com.br/",
    title: "Início",
    status: "done",
    http_status: 200,
    error: null,
    login_wall: false,
    scanned_at: "2026-11-12T10:00:05Z",
    counts_by_severity: zero,
    needs_review_count: 0,
    passed_count: 0,
    ...overrides,
  };
}

export function pageDetail(overrides: Partial<PageDetail> = {}): PageDetail {
  return { ...pageSummary(), axe_version: "4.11.0", passed_rules: [], ...overrides };
}

export function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: FINDING_ID,
    page_id: PAGE_ID,
    source: "axe",
    rule_id: "image-alt",
    help: "Images must have alternative text",
    wcag_criteria: ["1.1.1"],
    severity: "critical",
    needs_review: false,
    confidence: null,
    selector: "main > img",
    html_snippet: '<img src="mapa.png">',
    message: "Fix any of the following:\n  Element does not have an alt attribute",
    ...overrides,
  };
}

export function findingDetail(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    ...finding(),
    audit_id: AUDIT_ID,
    inserted_at: "2026-11-12T10:00:05Z",
    help_url: "https://dequeuniversity.com/rules/axe/4.11/image-alt",
    nodes_total: 1,
    axe_version: "4.11.0",
    who_is_affected: null,
    how_to_fix: null,
    ai_reason: null,
    ai_suggestion: null,
    ai_model: null,
    prompt_version: null,
    page: { id: PAGE_ID, url: "https://exemplo.com.br/", final_url: "https://exemplo.com.br/", title: "Início" },
    occurrences: { page: 1, audit: 1 },
    other_pages: [],
    ...overrides,
  };
}

// --- Catálogo dos critérios WCAG (`GET /api/wcag/criteria`) -------------------------------

export const WCAG_CRITERIA_PATH = "/api/wcag/criteria";
export const EMAG_URL = "https://emag.governoeletronico.gov.br/";

const W3C = "https://www.w3.org/Translations/WCAG22-pt-BR/#";

export function wcagCriterion(overrides: Partial<WcagCriterion> & Pick<WcagCriterion, "id">): WcagCriterion {
  return {
    level: "A",
    since: "2.0",
    title: `Título do ${overrides.id}`,
    summary: `Resumo do ${overrides.id}.`,
    who_is_affected: `Quem é afetado pelo ${overrides.id}.`,
    url: `${W3C}criterio-${overrides.id}`,
    emag: [],
    ...overrides,
  };
}

/**
 * Catálogo simulado e pequeno, com os casos dos critérios de aceite: 1.1.1 com a recomendação
 * 3.6; 1.4.3 com recomendações fora de ordem (3.10 antes de 3.9); 2.5.8 da WCAG 2.2 e 1.4.5 da
 * 2.0, os dois sem recomendação; 2.1.3 de nível AAA; 4.1.2 com vírgulas no título.
 */
export function wcagCatalog(extra: WcagCriterion[] = []): WcagCriteriaResponse {
  return {
    content_version: "0123456789ab",
    sources: {
      wcag: {
        name: "WCAG 2.2, Tradução Autorizada para o português do Brasil (W3C, 27/03/2025)",
        url: "https://www.w3.org/Translations/WCAG22-pt-BR-20250327/",
        license: "W3C Document License",
      },
      emag: { name: "Modelo de Acessibilidade em Governo Eletrônico (eMAG) 3.1", url: EMAG_URL, license: "CC BY 4.0" },
    },
    data: [
      wcagCriterion({
        id: "1.1.1",
        title: "Conteúdo Não Textual",
        summary: "Imagens que transmitem informação têm um texto equivalente.",
        who_is_affected: "Pessoas cegas que usam leitor de tela ouvem o texto alternativo no lugar da imagem.",
        url: `${W3C}non-text-content`,
        emag: [{ id: "3.6", title: "Fornecer alternativa em texto para as imagens do sítio" }],
      }),
      wcagCriterion({
        id: "1.4.3",
        level: "AA",
        title: "Contraste (Mínimo)",
        summary: "Texto tem contraste mínimo de 4,5:1 com o fundo.",
        who_is_affected: "Pessoas com baixa visão têm dificuldade para ler texto claro sobre fundo claro.",
        url: `${W3C}contrast-minimum`,
        emag: [
          { id: "3.10", title: "Recomendação de teste dez" },
          { id: "3.9", title: "Recomendação de teste nove" },
        ],
      }),
      wcagCriterion({ id: "1.4.5", level: "AA", title: "Imagens de Texto" }),
      wcagCriterion({ id: "1.4.10", level: "AA", since: "2.1", title: "Realinhar" }),
      wcagCriterion({ id: "2.1.1", title: "Teclado", emag: [{ id: "2.1", title: "Disponibilizar todas as funções da página via teclado" }] }),
      wcagCriterion({ id: "2.1.3", level: "AAA", title: "Teclado (Sem Exceção)", emag: [{ id: "2.1", title: "Disponibilizar todas as funções da página via teclado" }] }),
      wcagCriterion({ id: "2.4.4", title: "Finalidade do Link (Em Contexto)" }),
      wcagCriterion({ id: "2.5.8", level: "AA", since: "2.2", title: "Tamanho do Alvo (Mínimo)" }),
      wcagCriterion({ id: "4.1.2", title: "Nome, Função, Valor" }),
      ...extra,
    ],
  };
}
