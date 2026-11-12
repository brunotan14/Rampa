import { ApiError } from "./client";
import { retryDelay, shouldRetry } from "./queryClient";

const err = (code: string, status: number, retryAfter: Date | null = null) => new ApiError(code, "x", status, retryAfter);

describe("política de novas tentativas", () => {
  afterEach(() => vi.useRealTimers());

  it("tenta de novo queda de rede e erro do servidor, até 2 vezes", () => {
    expect(shouldRetry(0, err("network_error", 0))).toBe(true);
    expect(shouldRetry(1, err("internal_error", 500))).toBe(true);
    expect(shouldRetry(2, err("internal_error", 500))).toBe(false);
  });

  it("não tenta de novo erro 4xx (404 da auditoria, filtro inválido)", () => {
    expect(shouldRetry(0, err("audit_not_found", 404))).toBe(false);
    expect(shouldRetry(0, err("invalid_filter", 422))).toBe(false);
    expect(shouldRetry(0, new Error("outro"))).toBe(false);
  });

  it("429 espera o retry_after, se for curto; longo vai direto para a tela", () => {
    vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z") });
    const soon = err("rate_limited", 429, new Date("2026-11-12T10:00:05Z"));
    const later = err("rate_limited", 429, new Date("2026-11-12T11:00:00Z"));
    expect(shouldRetry(0, soon)).toBe(true);
    expect(retryDelay(0, soon)).toBe(5000);
    expect(shouldRetry(0, later)).toBe(false);
    expect(shouldRetry(0, err("rate_limited", 429))).toBe(false);
  });

  it("sem retry_after, espera 1 s, 2 s, 4 s... até 8 s", () => {
    expect(retryDelay(0, err("network_error", 0))).toBe(1000);
    expect(retryDelay(1, err("network_error", 0))).toBe(2000);
    expect(retryDelay(5, err("network_error", 0))).toBe(8000);
  });
});
