// Dados de exemplo nos formatos dos contratos (tipos gerados), para os testes.
import type { AuditSummary, ChannelProgress, Finding, FindingDetail, PageDetail, PageSummary } from "../src/api/types";

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
