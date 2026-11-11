import { randomInt } from "node:crypto";
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { env } from "./env.js";

// Ajudantes dos E2E integrados: criar auditoria com IP simulado, esperar o estado final e ler
// os achados. Os tipos espelham o contrato da API (`shared/openapi.json`, PRD §9).

export type AuditStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type Severity = "critical" | "serious" | "moderate" | "minor";
export type FindingSource = "axe" | "ai" | "heuristic";

export interface ApiError {
  error: { code: string; message: string; retry_after?: string };
}

export interface AuditSummary {
  id: string;
  status: AuditStatus;
  start_url: string;
  page_limit: number;
  pages_found: number;
  pages_scanned: number;
  pages_failed: number;
  totals_by_severity: Record<Severity, number>;
  needs_review_count: number;
  error: { code: string; message: string } | null;
  started_at: string | null;
  finished_at: string | null;
  inserted_at: string;
}

export interface Finding {
  id: string;
  page_id: string;
  source: FindingSource;
  rule_id: string;
  wcag_criteria: string[];
  severity: Severity;
  needs_review: boolean;
  confidence: number | null;
  selector: string | null;
  html_snippet: string | null;
  message: string | null;
}

export const FINAL_STATUSES: readonly AuditStatus[] = ["completed", "failed", "cancelled"];

/** URL de uma página do site de fixtures: `fixtureUrl("img-sem-alt.html")`. */
export function fixtureUrl(path: string): string {
  return `${env.fixturesUrl}/${path.replace(/^\/+/, "")}`;
}

// IPs simulados: 100.64.0.0/10 (fora da faixa confiável), a partir de um ponto sorteado por
// processo e depois em sequência. Dentro de um worker nunca se repetem; entre workers, a
// chance de colisão é desprezível. O banco é novo a cada `make e2e-integrado`.
const SIMULATED_BASE = (100 << 24) | (64 << 16);
const SIMULATED_SIZE = 1 << 22;
let simulatedNext = randomInt(SIMULATED_SIZE);

/**
 * IP novo de quem pede a auditoria, enviado no `X-Forwarded-For` pela faixa confiável. Cada
 * teste usa os seus, para um teste não gastar o limite por IP de outro.
 */
export function newClientIp(): string {
  const n = (SIMULATED_BASE + (simulatedNext++ % SIMULATED_SIZE)) >>> 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export interface PostAuditOptions {
  /** IP simulado no `X-Forwarded-For`. Padrão: um novo (`newClientIp()`). `null`: sem o cabeçalho. */
  clientIp?: string | null;
  /** Base da API. Padrão: `env.apiUrl` (faixa confiável). Ver `env.apiDirectUrl` e `env.apiDailyUrl`. */
  baseURL?: string;
  idempotencyKey?: string;
  pageLimit?: number;
  /** Corpo cru, no lugar de `{ url, page_limit }` (para os casos de corpo inválido). */
  body?: unknown;
}

export interface PostAuditResult {
  response: APIResponse;
  status: number;
  /** Corpo já lido: `{ id }` no 202, `ApiError` nos erros. */
  body: unknown;
  /** IP enviado no `X-Forwarded-For` (`null` se não foi enviado). */
  clientIp: string | null;
}

/** `POST /api/audits` sem conferir o resultado (para os casos de recusa). */
export async function postAudit(
  request: APIRequestContext,
  url: string,
  options: PostAuditOptions = {},
): Promise<PostAuditResult> {
  const clientIp = options.clientIp === undefined ? newClientIp() : options.clientIp;
  const headers: Record<string, string> = {};
  if (clientIp !== null) headers["x-forwarded-for"] = clientIp;
  if (options.idempotencyKey !== undefined) headers["idempotency-key"] = options.idempotencyKey;

  const data =
    options.body !== undefined
      ? options.body
      : { url, ...(options.pageLimit === undefined ? {} : { page_limit: options.pageLimit }) };

  const response = await request.post(`${options.baseURL ?? env.apiUrl}/api/audits`, { data, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Corpo que não é JSON fica como texto, para a mensagem da falha.
  }
  return { response, status: response.status(), body, clientIp };
}

/** `POST /api/audits` que precisa dar 202. Devolve o id e o IP simulado usado. */
export async function createAudit(
  request: APIRequestContext,
  url: string,
  options: PostAuditOptions = {},
): Promise<{ id: string; clientIp: string | null }> {
  const result = await postAudit(request, url, options);
  expect(result.status, `POST /api/audits ${url}: ${JSON.stringify(result.body)}`).toBe(202);
  const { id } = result.body as { id: string };
  return { id, clientIp: result.clientIp };
}

/** Erro da API (`{ error: { code, message } }`) de uma resposta de recusa. */
export function apiError(result: PostAuditResult): ApiError["error"] {
  expect(result.body, `resposta sem o formato de erro: ${JSON.stringify(result.body)}`).toMatchObject({
    error: { code: expect.any(String), message: expect.any(String) },
  });
  return (result.body as ApiError).error;
}

/** `GET /api/audits/:id`. */
export async function getAudit(
  request: APIRequestContext,
  id: string,
  options: { baseURL?: string } = {},
): Promise<AuditSummary> {
  const response = await request.get(`${options.baseURL ?? env.apiUrl}/api/audits/${id}`);
  expect(response.status(), `GET /api/audits/${id}: ${await response.text()}`).toBe(200);
  return (await response.json()) as AuditSummary;
}

/**
 * Espera a auditoria chegar a um estado final (`completed`, `failed` ou `cancelled`) e devolve
 * o resumo. Falha com mensagem clara se o prazo acabar. Uma página de fixture leva poucos
 * segundos; o prazo padrão cobre a fila e a subida do Chromium.
 */
export async function waitForAuditEnd(
  request: APIRequestContext,
  id: string,
  options: { baseURL?: string; timeoutMs?: number; intervalMs?: number } = {},
): Promise<AuditSummary> {
  const timeout = options.timeoutMs ?? 60_000;
  let last: AuditSummary | undefined;
  try {
    await expect
      .poll(
        async () => {
          last = await getAudit(request, id, options);
          return FINAL_STATUSES.includes(last.status);
        },
        { timeout, intervals: [options.intervalMs ?? 500] },
      )
      .toBe(true);
  } catch (cause) {
    throw new Error(`auditoria ${id} não terminou em ${timeout} ms (último resumo: ${JSON.stringify(last ?? null)})`, {
      cause,
    });
  }
  return last!;
}

export interface FindingFilters {
  severity?: Severity;
  source?: FindingSource;
  needs_review?: boolean;
}

/** Todos os achados da auditoria (`GET /api/audits/:id/findings`), seguindo o cursor. */
export async function listFindings(
  request: APIRequestContext,
  id: string,
  options: { baseURL?: string; filters?: FindingFilters } = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  let cursor: string | null = null;
  do {
    const params: Record<string, string> = { limit: "100" };
    for (const [key, value] of Object.entries(options.filters ?? {})) params[key] = String(value);
    if (cursor) params.cursor = cursor;
    const response = await request.get(`${options.baseURL ?? env.apiUrl}/api/audits/${id}/findings`, { params });
    expect(response.status(), `GET /api/audits/${id}/findings: ${await response.text()}`).toBe(200);
    const page = (await response.json()) as { data: Finding[]; next_cursor: string | null };
    findings.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor);
  return findings;
}

/** Resposta do scanner (`POST /scan`): só os campos que os E2E costumam conferir. */
export interface ScanResult {
  status: number;
  body: {
    final_url?: string;
    http_status?: number;
    title?: string;
    blocked_requests?: number;
    axe?: { violations: { id: string; impact: string | null }[]; incomplete: { id: string }[] };
    error?: string;
    detail?: string;
  };
}

/**
 * Chama o scanner direto (sem o app), para conferir o que não é gravado no banco, como
 * `blocked_requests` (PRD §7, contrato do scanner).
 */
export async function scanDirect(request: APIRequestContext, url: string): Promise<ScanResult> {
  const response = await request.post(`${env.scannerUrl}/scan`, { data: { url }, timeout: 120_000 });
  return { status: response.status(), body: (await response.json()) as ScanResult["body"] };
}
