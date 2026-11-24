// Critérios WCAG dos achados com o conteúdo do catálogo (RF-RA007, `GET /api/wcag/criteria`).
// O achado guarda só os números (`wcag_criteria`); título, nível, resumo, "quem é afetado" e as
// recomendações do eMAG vêm do catálogo, procurados aqui pelo número. Número fora do catálogo
// (o 4.1.1, removido na WCAG 2.2) e catálogo que não chegou ficam só com o número, como no M2.
import type { WcagCriteriaResponse, WcagCriterion, WcagSource } from "./api/types";
import { t } from "./i18n";

export interface CriteriaCatalog {
  readonly byId: ReadonlyMap<string, WcagCriterion>;
  readonly sources: { readonly wcag: WcagSource; readonly emag: WcagSource };
}

/** Do corpo da API para a procura por número (`select` do `useWcagCriteria`). */
// Um catálogo por resposta: o `select` roda em cada componente que usa o hook, e todos
// recebem o mesmo objeto.
const catalogs = new WeakMap<WcagCriteriaResponse, CriteriaCatalog>();

export function catalogFrom(response: WcagCriteriaResponse): CriteriaCatalog {
  let catalog = catalogs.get(response);
  if (catalog === undefined) {
    catalog = { byId: new Map(response.data.map((criterion) => [criterion.id, criterion])), sources: response.sources };
    catalogs.set(response, catalog);
  }
  return catalog;
}

/** Um critério do achado: com o conteúdo do catálogo ou, sem ele, só o número. */
export interface CriterionRef {
  id: string;
  criterion: WcagCriterion | null;
}

/** Ordem numérica por componente: 1.4.5 antes de 1.4.10; 3.9 antes de 3.10. */
export function compareNumbering(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? -1) - (right[i] ?? -1);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
  }
  return a.localeCompare(b);
}

/** Critérios do achado sem repetição, em ordem numérica, cada um com o conteúdo do catálogo ou só o número. */
export function criteriaFor(ids: readonly string[], catalog: CriteriaCatalog | null | undefined): CriterionRef[] {
  return [...new Set(ids)].sort(compareNumbering).map((id) => ({ id, criterion: catalog?.byId.get(id) ?? null }));
}

/** "1.1.1 Conteúdo Não Textual"; sem conteúdo, "WCAG 1.1.1" (como no M2). */
export function criterionShortLabel(ref: CriterionRef): string {
  return ref.criterion ? t.report.criteria.short(ref.id, ref.criterion.title) : t.report.criterion(ref.id);
}

/** Os critérios numa linha, com rótulo curto; sem nenhum, "Sem critério WCAG associado". */
export function criteriaText(ids: readonly string[], catalog: CriteriaCatalog | null | undefined): string {
  const refs = criteriaFor(ids, catalog);
  return refs.length > 0 ? refs.map(criterionShortLabel).join(t.report.criteria.listSeparator) : t.report.noCriteria;
}

export type WhoIsAffected =
  | { kind: "finding"; text: string }
  | { kind: "criteria"; items: { id: string; label: string; text: string }[] };

/**
 * "Quem é afetado" (FR-008): o texto do próprio achado (análises de IA e heurística, M4); senão,
 * o de cada critério conhecido; senão, nada (a seção não aparece).
 */
export function whoIsAffected(
  finding: { who_is_affected?: string | null },
  criteria: readonly CriterionRef[],
): WhoIsAffected | null {
  const own = finding.who_is_affected?.trim();
  if (own) return { kind: "finding", text: own };
  const items = criteria.flatMap((ref) =>
    ref.criterion && ref.criterion.who_is_affected.trim() !== ""
      ? [{ id: ref.id, label: criterionShortLabel(ref), text: ref.criterion.who_is_affected }]
      : [],
  );
  return items.length > 0 ? { kind: "criteria", items } : null;
}

/** Só links `https://` viram link na tela (o backend já confere os domínios oficiais). */
export function isHttpsUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("https://");
}
