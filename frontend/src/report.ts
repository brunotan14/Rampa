// Regras do relatório que mais de uma tela usa: ids das rotas, endereços, filtros na URL
// (RF-RA006: o link compartilhado mantém o filtro) e ordenação das páginas. Os nomes na URL são
// em português, como a interface (`?severidade=critico&origem=ia`); a conversão para os nomes da
// API (`severity=critical&source=ai`) fica aqui e em `severity.ts`.
import type { AuditStatus, FindingSource, FindingsFilters, PageSummary } from "./api/types";
import { API_SEVERITIES, fromApiSeverity, toApiSeverity, type FindingSeverity } from "./severity";

// --- Ids e endereços -------------------------------------------------------------------------

// Mesma forma que a API e o canal aceitam: 36 caracteres, minúsculos.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Id de rota na forma canônica do UUID; o resto é 404 no cliente, como na API. */
export function isAuditId(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}

/** Host do endereço auditado ("exemplo.com.br"), para títulos. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Caminho com a consulta ("/contato?x=1"), para listas. Endereço que não é URL fica inteiro. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Nome da página: o título dela, ou o caminho quando não tem título. */
export function pageName(page: { title: string | null; url: string; final_url?: string | null }): string {
  const title = page.title?.trim();
  return title ? title : pathOf(page.final_url ?? page.url);
}

export const reportPath = (auditId: string) => `/auditorias/${auditId}`;
export const pagesPath = (auditId: string, search = "") => `/auditorias/${auditId}/paginas${search}`;
export const pagePath = (auditId: string, pageId: string, search = "") =>
  `/auditorias/${auditId}/paginas/${pageId}${search}`;
export const findingPath = (auditId: string, findingId: string) => `/auditorias/${auditId}/problemas/${findingId}`;

// --- Andamento -------------------------------------------------------------------------------

/** A auditoria ainda anda (na fila ou em varredura): o que as telas do relatório mostram pode mudar. */
export function isRunning(audit: { status: AuditStatus } | null | undefined): boolean {
  return audit?.status === "queued" || audit?.status === "running";
}

/** Intervalo das novas buscas das telas do relatório enquanto a auditoria anda. */
export const LIVE_REFRESH_MS = 5_000;

// --- Origem do achado ------------------------------------------------------------------------

const SOURCE_PARAM = { axe: "axe", ai: "ia", heuristic: "heuristica" } as const satisfies Record<FindingSource, string>;
export type SourceParam = (typeof SOURCE_PARAM)[FindingSource];
export const SOURCES = ["axe", "ai", "heuristic"] as const satisfies readonly FindingSource[];

export function sourceParam(source: FindingSource): SourceParam {
  return SOURCE_PARAM[source];
}

function sourceFromParam(value: string | null): FindingSource | undefined {
  return SOURCES.find((source) => SOURCE_PARAM[source] === value);
}

// --- Confiança da IA -------------------------------------------------------------------------

export type ConfidenceBand = "alta" | "media" | "baixa";

/** design/components/AiReviewBadge: alta ≥ 80%, média 50–79%, baixa < 50%. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.8) return "alta";
  if (confidence >= 0.5) return "media";
  return "baixa";
}

// --- Filtros na URL --------------------------------------------------------------------------

/** Critério WCAG como a API aceita no filtro `wcag` ("1.4.3"). */
export const WCAG_CRITERION = /^[1-4]\.\d{1,2}\.\d{1,2}$/;

export type ReviewParam = "sim" | "nao";

/** Filtros dos problemas de uma página, com os nomes da interface. */
export interface FindingFilterState {
  severidade?: FindingSeverity;
  origem?: FindingSource;
  wcag?: string;
  revisao?: ReviewParam;
}

const SEVERITY_PARAMS: readonly FindingSeverity[] = API_SEVERITIES.map(fromApiSeverity);

function severityFromParam(value: string | null): FindingSeverity | undefined {
  return SEVERITY_PARAMS.find((severity) => severity === value);
}

function reviewFromParam(value: string | null): ReviewParam | undefined {
  return value === "sim" || value === "nao" ? value : undefined;
}

/**
 * Lê os filtros da URL. Valor que a interface não conhece é ignorado (como se não houvesse
 * filtro), em vez de mandar à API um filtro que ela recusaria.
 */
export function readFindingFilters(params: URLSearchParams): FindingFilterState {
  const wcag = params.get("wcag")?.trim();
  return {
    severidade: severityFromParam(params.get("severidade")),
    origem: sourceFromParam(params.get("origem")),
    wcag: wcag && WCAG_CRITERION.test(wcag) ? wcag : undefined,
    revisao: reviewFromParam(params.get("revisao")),
  };
}

/** Escreve os filtros na URL, mantendo os outros parâmetros (a aba, por exemplo). */
export function writeFindingFilters(params: URLSearchParams, filters: FindingFilterState): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ["severidade", "origem", "wcag", "revisao"] as const) next.delete(key);
  if (filters.severidade) next.set("severidade", filters.severidade);
  if (filters.origem) next.set("origem", sourceParam(filters.origem));
  if (filters.wcag) next.set("wcag", filters.wcag);
  if (filters.revisao) next.set("revisao", filters.revisao);
  return next;
}

export function hasFindingFilters(filters: FindingFilterState): boolean {
  return Boolean(filters.severidade || filters.origem || filters.wcag || filters.revisao);
}

/** Os filtros da URL como a API espera, na ordem por severidade (os da mesma regra juntos). */
export function toApiFilters(pageId: string, filters: FindingFilterState): FindingsFilters {
  return {
    page_id: pageId,
    sort: "severity",
    ...(filters.severidade ? { severity: toApiSeverity(filters.severidade) } : {}),
    ...(filters.origem ? { source: filters.origem } : {}),
    ...(filters.wcag ? { wcag: filters.wcag } : {}),
    ...(filters.revisao ? { needs_review: filters.revisao === "sim" ? "true" : "false" } : {}),
  };
}

// --- Lista de páginas ------------------------------------------------------------------------

export const PAGE_ORDERS = ["gravidade", "endereco", "status"] as const;
export type PageOrder = (typeof PAGE_ORDERS)[number];

/** Filtros e ordem da lista de páginas (`?severidade=critico&revisao=sim&ordem=endereco`). */
export interface PageListState {
  severidade?: FindingSeverity;
  revisao?: "sim";
  ordem: PageOrder;
}

export function readPageListState(params: URLSearchParams): PageListState {
  const order = PAGE_ORDERS.find((o) => o === params.get("ordem"));
  return {
    severidade: severityFromParam(params.get("severidade")),
    revisao: params.get("revisao") === "sim" ? "sim" : undefined,
    ordem: order ?? "gravidade",
  };
}

export function writePageListState(params: URLSearchParams, state: PageListState): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ["severidade", "revisao", "ordem"]) next.delete(key);
  if (state.severidade) next.set("severidade", state.severidade);
  if (state.revisao) next.set("revisao", state.revisao);
  if (state.ordem !== "gravidade") next.set("ordem", state.ordem);
  return next;
}

/**
 * Busca a levar da lista para a página: os filtros que valem também para os problemas dela
 * (severidade e revisão), para o link compartilhado continuar filtrado.
 */
export function pageLinkSearch(state: PageListState): string {
  const next = new URLSearchParams();
  if (state.severidade) next.set("severidade", state.severidade);
  if (state.revisao) next.set("revisao", state.revisao);
  const text = next.toString();
  return text === "" ? "" : `?${text}`;
}

// Página que falhou primeiro no "status"; depois as em andamento; as analisadas por último.
const STATUS_RANK: Record<PageSummary["status"], number> = { failed: 0, queued: 1, scanning: 1, analyzing: 2, done: 2 };

function compareSeverity(a: PageSummary, b: PageSummary): number {
  for (const severity of API_SEVERITIES) {
    const diff = b.counts_by_severity[severity] - a.counts_by_severity[severity];
    if (diff !== 0) return diff;
  }
  return b.needs_review_count - a.needs_review_count;
}

/** O endereço exibido (o final, depois de redirecionamentos) é o que ordena. */
const shownUrl = (page: PageSummary) => page.final_url ?? page.url;
const byUrl = (a: PageSummary, b: PageSummary) => shownUrl(a).localeCompare(shownUrl(b), "pt-BR");

/**
 * Se a página entra no filtro da lista, com o mesmo significado do filtro `severity` da API na
 * tela da página (confirmados e os que pedem revisão). Os totais da página têm a severidade só
 * dos confirmados e um total único dos que pedem revisão: quando eles não decidem, a resposta é
 * `"ask"` e a tela pergunta à API quantos achados para confirmar daquela severidade a página tem
 * (`reviewFindingsFilters`). Assim o link nunca leva a uma página vazia por diferença de regra.
 */
export function pageMatch(page: PageSummary, state: PageListState): boolean | "ask" {
  const reviewOnly = state.revisao === "sim";
  if (!state.severidade) return !reviewOnly || page.needs_review_count > 0;
  const severity = toApiSeverity(state.severidade);
  if (!reviewOnly && page.counts_by_severity[severity] > 0) return true;
  return page.needs_review_count > 0 ? "ask" : false;
}

/** Filtros da pergunta de `pageMatch`: só o total (`limit` 1) de achados para confirmar. */
export function reviewFindingsFilters(pageId: string, severity: FindingSeverity): FindingsFilters {
  return { page_id: pageId, severity: toApiSeverity(severity), needs_review: "true", limit: 1 };
}

/**
 * Filtra e ordena (a API manda na ordem de entrada; a ordem é do cliente). `reviewTotals` traz,
 * por página, o total de achados para confirmar da severidade filtrada; página que dependia
 * dele e ainda não tem a resposta fica de fora (a tela diz que está aplicando o filtro).
 */
export function filterAndSortPages(
  pages: readonly PageSummary[],
  state: PageListState,
  reviewTotals: ReadonlyMap<string, number> = new Map(),
): PageSummary[] {
  const filtered = pages.filter((page) => {
    const match = pageMatch(page, state);
    return match === "ask" ? (reviewTotals.get(page.id) ?? 0) > 0 : match;
  });
  const compare =
    state.ordem === "endereco"
      ? byUrl
      : state.ordem === "status"
        ? (a: PageSummary, b: PageSummary) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byUrl(a, b)
        : (a: PageSummary, b: PageSummary) => compareSeverity(a, b) || byUrl(a, b);
  return [...filtered].sort(compare);
}
