// Query keys do TanStack Query, num lugar só. Tudo de uma auditoria fica sob
// `["audits", id]`: invalidar esse prefixo recarrega resumo, páginas e achados juntos.
import type { FindingsFilters } from "./types";

export const queryKeys = {
  all: ["audits"] as const,
  audit: (auditId: string) => ["audits", auditId] as const,
  pages: (auditId: string) => ["audits", auditId, "pages"] as const,
  page: (auditId: string, pageId: string) => ["audits", auditId, "pages", pageId] as const,
  /** Prefixo de todas as listas de achados da auditoria, com qualquer filtro. */
  findingsAll: (auditId: string) => ["audits", auditId, "findings"] as const,
  findings: (auditId: string, filters: FindingsFilters = {}) => ["audits", auditId, "findings", filters] as const,
  /** Só o `total` de uma lista de achados (`limit` 1), sem paginação: fora de `findingsAll`. */
  findingsTotal: (auditId: string, filters: FindingsFilters) => ["audits", auditId, "findings-total", filters] as const,
  finding: (auditId: string, findingId: string) => ["audits", auditId, "finding", findingId] as const,
};
