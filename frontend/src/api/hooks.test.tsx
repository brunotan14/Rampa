import { act, renderHook, waitFor } from "@testing-library/react";
import { AUDIT_ID, PAGE_ID, auditSummary } from "../../test/fixtures";
import { jsonResponse, testQueryClient, withQueryClient } from "../../test/render";
import { idempotencyScope, useAudit, useCreateAudit, useFinding, useFindings, usePage, usePages } from "./hooks";
import { queryKeys } from "./queryKeys";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
const keyOf = (call: number) => new Headers(fetchMock.mock.calls[call]![1]!.headers).get("Idempotency-Key");

describe("hooks da API", () => {
  it("useAudit guarda o resumo na query key da auditoria", async () => {
    fetchMock.mockResolvedValue(jsonResponse(auditSummary({ revision: 3 })));
    const client = testQueryClient();
    const { result } = renderHook(() => useAudit(AUDIT_ID), { wrapper: withQueryClient(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.revision).toBe(3);
    expect(client.getQueryData(queryKeys.audit(AUDIT_ID))).toEqual(result.current.data);
  });

  it("useAudit com 404 dá o erro audit_not_found da API", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "audit_not_found", message: "Auditoria não encontrada." } }, { status: 404 }),
    );
    const { result } = renderHook(() => useAudit(AUDIT_ID), { wrapper: withQueryClient() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: "audit_not_found", message: "Auditoria não encontrada." });
  });

  it("usePages, usePage e useFinding buscam os endpoints aninhados", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}));
    const wrapper = withQueryClient();
    renderHook(() => usePages(AUDIT_ID), { wrapper });
    renderHook(() => usePage(AUDIT_ID, PAGE_ID), { wrapper });
    renderHook(() => useFinding(AUDIT_ID, PAGE_ID), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(urls().sort()).toEqual(
      [
        `/api/audits/${AUDIT_ID}/pages`,
        `/api/audits/${AUDIT_ID}/pages/${PAGE_ID}`,
        `/api/audits/${AUDIT_ID}/findings/${PAGE_ID}`,
      ].sort(),
    );
  });

  it("useFindings segue o next_cursor até o fim da lista", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "a" }], next_cursor: "c1", total: 2 }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "b" }], next_cursor: null, total: null }));
    const { result } = renderHook(() => useFindings(AUDIT_ID, { severity: "serious" }), { wrapper: withQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data?.pages.flatMap((p) => p.data.map((f) => f.id))).toEqual(["a", "b"]));
    expect(result.current.hasNextPage).toBe(false);
    expect(urls()[0]).toBe(`/api/audits/${AUDIT_ID}/findings?severity=serious`);
    expect(urls()[1]).toBe(`/api/audits/${AUDIT_ID}/findings?severity=serious&cursor=c1`);
  });

  it("useCreateAudit repete a mesma Idempotency-Key para a mesma URL depois de uma falha", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: "internal_error", message: "x" } }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ id: AUDIT_ID }, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ id: AUDIT_ID }, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ id: AUDIT_ID }, { status: 202 }));
    const { result } = renderHook(() => useCreateAudit(), { wrapper: withQueryClient() });

    await act(async () => {
      await result.current.mutateAsync({ url: "exemplo.com.br" }).catch(() => undefined);
    });
    await act(() => result.current.mutateAsync({ url: "exemplo.com.br" }));
    // depois do sucesso, a mesma URL ganha chave nova; outra URL também
    await act(() => result.current.mutateAsync({ url: "exemplo.com.br" }));
    await act(() => result.current.mutateAsync({ url: "outro.com.br" }));

    expect(keyOf(0)).toBeTruthy();
    expect(keyOf(1)).toBe(keyOf(0));
    expect(keyOf(2)).not.toBe(keyOf(1));
    expect(keyOf(3)).not.toBe(keyOf(2));
  });

  it("useCreateAudit: mesma URL com page_limit diferente é outro pedido, com outra chave", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: { code: "internal_error", message: "x" } }, { status: 500 }),
    );
    const { result } = renderHook(() => useCreateAudit(), { wrapper: withQueryClient() });
    const send = (input: { url: string; page_limit?: number }) =>
      act(async () => {
        await result.current.mutateAsync(input).catch(() => undefined);
      });
    await send({ url: "exemplo.com.br", page_limit: 5 });
    await send({ url: "  https://exemplo.com.br/#topo ", page_limit: 5 });
    await send({ url: "exemplo.com.br", page_limit: 10 });
    expect(keyOf(1)).toBe(keyOf(0));
    expect(keyOf(2)).not.toBe(keyOf(1));
  });

  it("useCreateAudit descarta a chave num erro definitivo (4xx), mas não no 429", async () => {
    const replies = [
      jsonResponse({ error: { code: "rate_limited", message: "x", retry_after: "2026-11-12T17:32:00Z" } }, { status: 429 }),
      jsonResponse({ error: { code: "blocked_address", message: "x" } }, { status: 422 }),
      jsonResponse({ id: AUDIT_ID }, { status: 202 }),
    ];
    fetchMock.mockImplementation(async () => replies.shift()!);
    const { result } = renderHook(() => useCreateAudit(), { wrapper: withQueryClient() });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await result.current.mutateAsync({ url: "exemplo.com.br" }).catch(() => undefined);
      });
    }
    expect(keyOf(1)).toBe(keyOf(0)); // depois do 429, a mesma
    expect(keyOf(2)).not.toBe(keyOf(1)); // depois do 422, nova
  });

  it("a chave considera a URL normalizada no cliente e o page_limit", () => {
    expect(idempotencyScope({ url: " Exemplo.com.br#x" })).toBe(idempotencyScope({ url: "https://exemplo.com.br/" }));
    expect(idempotencyScope({ url: "exemplo.com.br", page_limit: 1 })).not.toBe(
      idempotencyScope({ url: "exemplo.com.br", page_limit: 2 }),
    );
    expect(idempotencyScope({ url: "http://exemplo.com.br" })).not.toBe(idempotencyScope({ url: "exemplo.com.br" }));
  });

  it("useCreateAudit repete sozinho uma queda de rede, com a mesma chave", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ id: AUDIT_ID }, { status: 202 }));
    const { result } = renderHook(() => useCreateAudit(), { wrapper: withQueryClient() });
    await act(() => result.current.mutateAsync({ url: "exemplo.com.br" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
    await waitFor(() => expect(result.current.data).toEqual({ id: AUDIT_ID }));
  });

  it("useCreateAudit não repete 429: o erro chega com o retry_after", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "rate_limited", message: "Tente de novo a partir das 14:32.", retry_after: "2026-11-12T17:32:00Z" } },
        { status: 429 },
      ),
    );
    const { result } = renderHook(() => useCreateAudit(), { wrapper: withQueryClient() });
    await act(async () => {
      await result.current.mutateAsync({ url: "exemplo.com.br" }).catch(() => undefined);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.error).toMatchObject({ code: "rate_limited", status: 429 }));
  });
});
