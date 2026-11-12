// Dados de exemplo nos formatos dos contratos (tipos gerados), para os testes.
import type { AuditSummary, ChannelProgress } from "../src/api/types";

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
    score: null,
    top_issues: [],
    error: null,
    inserted_at: "2026-11-12T10:00:00Z",
    started_at: "2026-11-12T10:00:01Z",
    finished_at: null,
    ...overrides,
  };
}
