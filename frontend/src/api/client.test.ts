import { jsonResponse } from "../../test/render";
import { AUDIT_ID, PAGE_ID, auditSummary } from "../../test/fixtures";
import { ApiError, createAudit, getAudit, getFinding, getPage, listFindings, listPages } from "./client";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), init: init ?? {} };
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("a promessa não falhou");
}

describe("cliente da API", () => {
  it("busca o resumo da auditoria e devolve o corpo tipado", async () => {
    fetchMock.mockResolvedValue(jsonResponse(auditSummary({ revision: 7 })));
    const audit = await getAudit(AUDIT_ID);
    expect(audit.revision).toBe(7);
    expect(lastCall().url).toBe(`/api/audits/${AUDIT_ID}`);
    expect(new Headers(lastCall().init.headers).get("Accept")).toBe("application/json");
  });

  it("monta os caminhos aninhados sob a auditoria, com os ids codificados", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: [] }));
    await listPages(AUDIT_ID);
    expect(lastCall().url).toBe(`/api/audits/${AUDIT_ID}/pages`);
    await getPage(AUDIT_ID, PAGE_ID);
    expect(lastCall().url).toBe(`/api/audits/${AUDIT_ID}/pages/${PAGE_ID}`);
    await getFinding(AUDIT_ID, "a/b?c");
    expect(lastCall().url).toBe(`/api/audits/${AUDIT_ID}/findings/a%2Fb%3Fc`);
  });

  it("passa filtros e cursor dos achados na query, sem os vazios", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: [], next_cursor: null, total: 0 }));
    await listFindings(AUDIT_ID, { severity: "critical", needs_review: "false", sort: "severity" }, "abc+/=");
    const url = new URL(lastCall().url, "http://x");
    expect(url.pathname).toBe(`/api/audits/${AUDIT_ID}/findings`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      severity: "critical",
      needs_review: "false",
      sort: "severity",
      cursor: "abc+/=",
    });
    await listFindings(AUDIT_ID);
    expect(lastCall().url).toBe(`/api/audits/${AUDIT_ID}/findings`);
  });

  it("cria a auditoria com POST, JSON e Idempotency-Key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: AUDIT_ID }, { status: 202 }));
    const created = await createAudit({ url: "exemplo.com.br" }, "chave-1");
    expect(created.id).toBe(AUDIT_ID);
    const { url, init } = lastCall();
    expect(url).toBe("/api/audits");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe("chave-1");
    expect(JSON.parse(String(init.body))).toEqual({ url: "exemplo.com.br" });
  });

  it("erro da API sai com o code, a message em português e o status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "audit_not_found", message: "Auditoria não encontrada. Confira o endereço do relatório." } },
        { status: 404 },
      ),
    );
    const error = await caught(getAudit(AUDIT_ID));
    expect(error).toMatchObject({
      code: "audit_not_found",
      message: "Auditoria não encontrada. Confira o endereço do relatório.",
      status: 404,
      retryAfter: null,
    });
  });

  it("422 de URL recusada mantém a mensagem da API", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "unsupported_scheme", message: "Só endereços web (http:// ou https://) podem ser auditados." } },
        { status: 422 },
      ),
    );
    const error = await caught(createAudit({ url: "ftp://exemplo.com" }));
    expect(error.code).toBe("unsupported_scheme");
    expect(error.message).toBe("Só endereços web (http:// ou https://) podem ser auditados.");
  });

  it("429 traz o retry_after do corpo como data", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "rate_limited",
            message: "Você atingiu o limite de auditorias por hora. Tente de novo a partir das 14:32.",
            retry_after: "2026-11-12T17:32:00Z",
          },
        },
        { status: 429, headers: { "Retry-After": "120" } },
      ),
    );
    const error = await caught(createAudit({ url: "exemplo.com.br" }));
    expect(error.code).toBe("rate_limited");
    expect(error.status).toBe(429);
    expect(error.retryAfter?.toISOString()).toBe("2026-11-12T17:32:00.000Z");
    expect(error.message).toMatch(/14:32/);
  });

  it("429 sem retry_after no corpo usa o cabeçalho Retry-After (segundos)", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z") });
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "rate_limited", message: "Limite." } }, { status: 429, headers: { "Retry-After": "90" } }),
    );
    const error = await caught(getAudit(AUDIT_ID));
    expect(error.retryAfter?.toISOString()).toBe("2026-11-12T10:01:30.000Z");
  });

  it("erro sem message usa a mensagem do i18n para o código", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "daily_limit_reached" } }, { status: 429 }));
    const error = await caught(createAudit({ url: "exemplo.com.br" }));
    expect(error.message).toBe("O limite de auditorias de hoje acabou. Tente de novo amanhã.");
  });

  it("queda de rede vira network_error, com status 0 e mensagem em português", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await caught(getAudit(AUDIT_ID));
    expect(error).toMatchObject({ code: "network_error", status: 0 });
    expect(error.message).toBe("Não conseguimos falar com o Rampa. Confira a sua conexão e tente de novo.");
  });

  it("resposta fora do formato (502 do proxy em HTML) vira unexpected_response", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 }));
    const error = await caught(getAudit(AUDIT_ID));
    expect(error).toMatchObject({ code: "unexpected_response", status: 502 });
  });

  it("200 sem corpo JSON também é unexpected_response", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const error = await caught(getAudit(AUDIT_ID));
    expect(error.code).toBe("unexpected_response");
  });

  it("cancelamento passa adiante como AbortError, sem virar erro de rede", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(getAudit(AUDIT_ID, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
