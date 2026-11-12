// Módulo único da severidade (CLAUDE.md): a API usa os nomes do axe (`critical`, `serious`,
// `moderate`, `minor`) e o design system os nomes em português (`critico`, `serio`...). Toda
// conversão, rótulo e ícone de severidade sai daqui.
import type { ApiSeverity, SeverityTotals } from "./api/types";
import type { IconName } from "./components/Icon";
import { plural, t } from "./i18n";

/** Os seis níveis do design system (design/README.md, Severidade). */
export type Severity = "critico" | "serio" | "moderado" | "menor" | "sucesso" | "revisao";

/** Os níveis que um achado pode ter (os quatro do axe). */
export type FindingSeverity = Extract<Severity, "critico" | "serio" | "moderado" | "menor">;

const FROM_API = {
  critical: "critico",
  serious: "serio",
  moderate: "moderado",
  minor: "menor",
} as const satisfies Record<ApiSeverity, FindingSeverity>;

const TO_API = {
  critico: "critical",
  serio: "serious",
  moderado: "moderate",
  menor: "minor",
} as const satisfies Record<FindingSeverity, ApiSeverity>;

/** Do mais grave para o menos grave, com os nomes da API (ordem do axe). */
export const API_SEVERITIES = ["critical", "serious", "moderate", "minor"] as const satisfies readonly ApiSeverity[];

/** Do mais grave para o menos grave, com os nomes do design system. */
export const FINDING_SEVERITIES = API_SEVERITIES.map((s) => FROM_API[s]);

export function fromApiSeverity(severity: ApiSeverity): FindingSeverity {
  return FROM_API[severity];
}

export function toApiSeverity(severity: FindingSeverity): ApiSeverity {
  return TO_API[severity];
}

/** Rótulo do selo: "Crítico", "Aprovado", "Confirme manualmente". */
export function severityLabel(severity: Severity): string {
  return t.severity.label[severity];
}

/** Rótulo com contagem: "3 críticos", "1 sério", "0 menores". */
export function severityCountLabel(severity: Severity, count: number): string {
  const [one, many] = t.severity.count[severity];
  return plural(count, one, many);
}

/** Só a palavra da contagem ("críticos", "sério"), para o selo pôr o número em destaque. */
export function severityCountWord(severity: Severity, count: number): string {
  const [one, many] = t.severity.count[severity];
  return count === 1 ? one : many;
}

/** Ícone do nível: cada severidade tem forma própria (octógono, triângulo, losango...). */
export function severityIcon(severity: Severity): IconName {
  return severity;
}

/** Rótulo no plural, para cabeçalho de contagem: "Críticos", "Menores". */
export function severityPluralLabel(severity: FindingSeverity): string {
  return t.severity.plural[severity];
}

/** Definição curta, para legenda e dica. */
export function severityDescription(severity: Severity): string {
  return t.severity.description[severity];
}

/** Totais da API (`totals_by_severity`) na ordem e com os nomes do design system. */
export function severityTotals(totals: SeverityTotals): { severity: FindingSeverity; count: number }[] {
  return API_SEVERITIES.map((s) => ({ severity: FROM_API[s], count: totals[s] }));
}

/** Soma dos totais (achados confirmados, sem os que pedem revisão). */
export function totalProblems(totals: SeverityTotals): number {
  return API_SEVERITIES.reduce((sum, s) => sum + totals[s], 0);
}
