// Query keys do TanStack Query, num lugar só. Tudo de uma auditoria fica sob
// `["audits", id]`: invalidar esse prefixo recarrega resumo, páginas e achados juntos.
import type { FindingsFilters } from "./types";

export const queryKeys = {
  all: ["audits"] as const,
  audit: (auditId: string) => ["audits", auditId] as const,
  pages: (auditId: string) => ["audits", auditId, "pages"] as const,
  page: (auditId: string, pageId: string) => ["audits", auditId, "pages", pageId] as const,
  findings: (auditId: string, filters: FindingsFilters = {}) => ["audits", auditId, "findings", filters] as const,
  finding: (auditId: string, findingId: string) => ["audits", auditId, "finding", findingId] as const,
};
