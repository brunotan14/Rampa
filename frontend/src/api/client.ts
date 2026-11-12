// Cliente da API REST (PRD §9), tipado pelos tipos gerados de shared/openapi.json.
// Todo erro sai como `ApiError` com o `{code, message}` da API; sem resposta (rede caiu,
// servidor fora do ar) o código é `network_error`, e resposta fora do formato vira
// `unexpected_response`. O 429 traz `retryAfter` (de `error.retry_after` ou do cabeçalho
// `Retry-After`).
import { errorMessage } from "../i18n";
import type { operations } from "./schema.gen";
import type { CreateAuditRequest, FindingsFilters, KnownErrorCode } from "./types";

// Corpo JSON da resposta de sucesso de uma operação do OpenAPI (`operationId`).
type Responses<O extends keyof operations> = operations[O]["responses"];
type JsonOk<O extends keyof operations, S extends keyof Responses<O> = 200 & keyof Responses<O>> =
  Responses<O>[S] extends { content: { "application/json": infer Body } } ? Body : never;

export class ApiError extends Error {
  /** Código estável do erro (`audit_not_found`, `network_error`...). Pode ser um código novo da API. */
  readonly code: KnownErrorCode | (string & {});
  /** Status HTTP; 0 quando não houve resposta. */
  readonly status: number;
  /** A partir de quando dá para tentar de novo (429); `null` se a API não disse. */
  readonly retryAfter: Date | null;

  constructor(code: string, message: string, status: number, retryAfter: Date | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

type RequestOptions = { signal?: AbortSignal };

const API_BASE = "/api";

function encode(segment: string) {
  return encodeURIComponent(segment);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRetryAfter(body: Record<string, unknown> | undefined, header: string | null): Date | null {
  const fromBody = body?.["retry_after"];
  if (typeof fromBody === "string") {
    const date = new Date(fromBody);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(Date.now() + seconds * 1000);
    const date = new Date(header);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function errorFromResponse(response: Response, body: unknown): ApiError {
  const error = isRecord(body) && isRecord(body["error"]) ? body["error"] : undefined;
  const code = typeof error?.["code"] === "string" ? error["code"] : undefined;
  const retryAfter = parseRetryAfter(error, response.headers.get("Retry-After"));
  if (code === undefined) {
    return new ApiError("unexpected_response", errorMessage("unexpected_response"), response.status, retryAfter);
  }
  const message = typeof error?.["message"] === "string" && error["message"] !== "" ? error["message"] : errorMessage(code);
  return new ApiError(code, message, response.status, retryAfter);
}

/**
 * Faz a requisição e devolve o corpo JSON. Cancelamento (`AbortSignal`) passa adiante como
 * `AbortError`, para o TanStack Query tratar; o resto vira `ApiError`.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
      credentials: "same-origin",
    });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new ApiError("network_error", errorMessage("network_error"), 0);
  }

  const body = await readJson(response);
  if (!response.ok) throw errorFromResponse(response, body);
  if (body === undefined) {
    throw new ApiError("unexpected_response", errorMessage("unexpected_response"), response.status);
  }
  return body as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

// --- Endpoints ---------------------------------------------------------------------------

export function getAudit(id: string, options: RequestOptions = {}) {
  return request<JsonOk<"getAudit">>(`/audits/${encode(id)}`, options);
}

export function listPages(auditId: string, options: RequestOptions = {}) {
  return request<JsonOk<"listPages">>(`/audits/${encode(auditId)}/pages`, options);
}

export function getPage(auditId: string, pageId: string, options: RequestOptions = {}) {
  return request<JsonOk<"getPage">>(`/audits/${encode(auditId)}/pages/${encode(pageId)}`, options);
}

export function listFindings(
  auditId: string,
  filters: FindingsFilters = {},
  cursor: string | null = null,
  options: RequestOptions = {},
) {
  const params = { ...filters, cursor: cursor ?? undefined };
  return request<JsonOk<"listFindings">>(`/audits/${encode(auditId)}/findings${query(params)}`, options);
}

export function getFinding(auditId: string, findingId: string, options: RequestOptions = {}) {
  return request<JsonOk<"getFinding">>(`/audits/${encode(auditId)}/findings/${encode(findingId)}`, options);
}

/**
 * Cria uma auditoria. Com a mesma `idempotencyKey`, repetir o pedido (depois de uma queda de
 * rede, por exemplo) devolve o mesmo `id` sem criar outra auditoria (PRD §9).
 */
export function createAudit(body: CreateAuditRequest, idempotencyKey?: string, options: RequestOptions = {}) {
  return request<JsonOk<"createAudit", 202>>("/audits", {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}
