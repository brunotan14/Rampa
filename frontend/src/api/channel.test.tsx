import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { FakeSocket } from "../../test/fakeSocket";
import { AUDIT_ID, PAGE_ID, auditSummary, progress } from "../../test/fixtures";
import { jsonResponse, testQueryClient } from "../../test/render";
import { AuditSocketProvider, BATCH_MS, SILENCE_MS, useAuditChannel, type AuditChannelState } from "./channel";
import { queryKeys } from "./queryKeys";
import type { AuditSummary } from "./types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(auditId = AUDIT_ID) {
  const socket = new FakeSocket();
  const client = testQueryClient();
  const states: AuditChannelState[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuditSocketProvider socket={socket}>{children}</AuditSocketProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    ({ id }) => {
      const state = useAuditChannel(id);
      states.push(state);
      return state;
    },
    { wrapper, initialProps: { id: auditId } },
  );
  return { socket, client, states, ...view, channel: () => socket.last };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const scanned = (revision: number, over = {}) => ({
  revision,
  progress: progress({ pages_scanned: revision, ...over }),
  page_id: PAGE_ID,
  counts_by_severity: { critical: 1, serious: 0, moderate: 0, minor: 0 },
  needs_review_count: 0,
});

describe("useAuditChannel", () => {
  it("entra no canal audit:<id> e aplica o snapshot do join na hora", () => {
    const { result, channel } = setup();
    expect(channel().topic).toBe(`audit:${AUDIT_ID}`);
    expect(result.current.connection).toBe("connecting");
    expect(result.current.progress).toBeNull();

    act(() => channel().reply({ revision: 1, progress: progress({ status: "queued" }) }));
    expect(result.current.connection).toBe("open");
    expect(result.current.revision).toBe(1);
    expect(result.current.progress?.status).toBe("queued");
  });

  it("agrega os eventos em lotes de 500 ms: um render por lote", async () => {
    const { result, channel, states } = setup();
    act(() => channel().reply({ revision: 1, progress: progress() }));
    const before = states.length;

    act(() => {
      channel().push("page_scanned", scanned(2));
      channel().push("page_scanned", scanned(3));
      channel().push("status_changed", { revision: 4, progress: progress({ pages_scanned: 4 }), status: "running" });
    });
    await advance(BATCH_MS - 1);
    expect(result.current.revision).toBe(1);
    expect(states.length).toBe(before);

    await advance(1);
    expect(result.current.revision).toBe(4);
    expect(result.current.progress?.pages_scanned).toBe(4);
    expect(states.length).toBe(before + 1);
  });

  it("aplica o progress só se a revision for maior, mesmo fora de ordem", async () => {
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 5, progress: progress({ pages_scanned: 5 }) }));

    act(() => channel().push("page_scanned", scanned(3, { pages_scanned: 99 })));
    await advance(BATCH_MS);
    expect(result.current.revision).toBe(5);
    expect(result.current.progress?.pages_scanned).toBe(5);

    act(() => {
      channel().push("page_scanned", scanned(7));
      channel().push("page_scanned", scanned(6));
    });
    await advance(BATCH_MS);
    expect(result.current.revision).toBe(7);
    expect(result.current.progress?.pages_scanned).toBe(7);
  });

  it("os campos próprios do evento (page_id) valem mesmo com revision antiga", async () => {
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 5, progress: progress() }));
    const error = { code: "timeout", message: "A página demorou demais para carregar ou para ser analisada." };
    act(() => channel().push("page_failed", { revision: 2, progress: progress(), page_id: PAGE_ID, error }));
    await advance(BATCH_MS);
    expect(result.current.revision).toBe(5);
    expect(result.current.pages).toEqual([{ pageId: PAGE_ID, kind: "failed", error }]);
  });

  it("anuncia a conclusão uma única vez, quando o status passa de não final a final", async () => {
    const { result, channel, states } = setup();
    act(() => channel().reply({ revision: 1, progress: progress() }));
    expect(result.current.announcement).toBeNull();

    const done = progress({
      status: "completed",
      pages_scanned: 2,
      totals_by_severity: { critical: 2, serious: 1, moderate: 0, minor: 0 },
    });
    act(() => channel().push("audit_completed", { revision: 2, progress: done, score: null }));
    await advance(BATCH_MS);
    expect(result.current.announcement).toBe("Auditoria concluída: 3 problemas em 2 páginas.");

    // Snapshot repetido (novo join) e evento atrasado não anunciam de novo.
    act(() => channel().reply({ revision: 2, progress: done }));
    act(() => channel().push("audit_completed", { revision: 2, progress: done, score: null }));
    await advance(BATCH_MS);
    // Uma transição só para um texto novo, e o anúncio continua o mesmo depois.
    const changes = states.filter((s, i) => s.announcement !== null && s.announcement !== states[i - 1]?.announcement);
    expect(changes.map((s) => s.announcement)).toEqual(["Auditoria concluída: 3 problemas em 2 páginas."]);
    expect(result.current.announcement).toBe("Auditoria concluída: 3 problemas em 2 páginas.");
  });

  it("não anuncia ao abrir uma auditoria que já estava encerrada", async () => {
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 9, progress: progress({ status: "completed", pages_scanned: 1 }) }));
    await advance(BATCH_MS);
    expect(result.current.progress?.status).toBe("completed");
    expect(result.current.announcement).toBeNull();
  });

  it("auditoria que falhou anuncia o motivo", async () => {
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 1, progress: progress({ status: "queued" }) }));
    const error = { code: "unresolvable", message: "Não encontramos este domínio. Confira se o endereço está certo." } as const;
    act(() => channel().push("audit_failed", { revision: 2, progress: progress({ status: "failed", error }) }));
    await advance(BATCH_MS);
    expect(result.current.announcement).toBe(
      "A auditoria parou. Não encontramos este domínio. Confira se o endereço está certo.",
    );
  });

  it("queda da conexão: marca reconectando e o snapshot do novo join reconcilia e anuncia", async () => {
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 1, progress: progress({ pages_found: 5, pages_scanned: 1 }) }));

    act(() => channel().drop());
    expect(result.current.connection).toBe("reconnecting");

    // Durante a queda a auditoria terminou; o phoenix refaz o join e chega o estado real.
    const done = progress({ status: "completed", pages_found: 5, pages_scanned: 5 });
    act(() => channel().reply({ revision: 12, progress: done }));
    expect(result.current.connection).toBe("open");
    await advance(BATCH_MS);
    expect(result.current.revision).toBe(12);
    expect(result.current.progress?.pages_scanned).toBe(5);
    expect(result.current.announcement).toBe("Auditoria concluída: 0 problemas em 5 páginas.");
  });

  it("depois de 30 s sem evento, busca GET /api/audits/:id e aplica se a revision for maior", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(auditSummary({ revision: 3, pages_scanned: 1 })));
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 1, progress: progress() }));

    await advance(SILENCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/audits/${AUDIT_ID}`);
    await advance(BATCH_MS);
    expect(result.current.revision).toBe(3);
    expect(result.current.progress?.pages_scanned).toBe(1);

    // Continua em silêncio: busca de novo a cada 30 s.
    await advance(SILENCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cada evento recomeça a contagem dos 30 s", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(auditSummary()));
    const { channel } = setup();
    act(() => channel().reply({ revision: 1, progress: progress() }));
    await advance(20_000);
    act(() => channel().push("page_scanned", scanned(2)));
    await advance(20_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET com revision menor não volta o estado atrás", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(auditSummary({ revision: 2, pages_scanned: 0 })));
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 4, progress: progress({ pages_scanned: 4 }) }));
    await advance(SILENCE_MS + BATCH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.revision).toBe(4);
    expect(result.current.progress?.pages_scanned).toBe(4);
  });

  it("auditoria encerrada não faz GET por silêncio", async () => {
    const { channel } = setup();
    act(() => channel().reply({ revision: 2, progress: progress({ status: "completed" }) }));
    await advance(SILENCE_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GET que falha por rede tenta de novo nos próximos 30 s", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockImplementation(async () => jsonResponse(auditSummary({ revision: 8 })));
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 1, progress: progress() }));
    await advance(SILENCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    await advance(SILENCE_MS + BATCH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.revision).toBe(8);
  });

  it("join recusado (auditoria inexistente): sai do canal, expõe o erro e não busca mais", async () => {
    const { result, channel } = setup();
    act(() =>
      channel().refuse({
        error: { code: "audit_not_found", message: "Auditoria não encontrada. Confira o endereço do relatório." },
      }),
    );
    expect(channel().left).toBe(true);
    expect(result.current.error).toMatchObject({
      code: "audit_not_found",
      message: "Auditoria não encontrada. Confira o endereço do relatório.",
    });
    await advance(SILENCE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GET de silêncio com 404 vira o erro audit_not_found", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: { code: "audit_not_found", message: "Auditoria não encontrada." } }, { status: 404 }),
    );
    const { result } = setup();
    await advance(SILENCE_MS);
    expect(result.current.error).toMatchObject({ code: "audit_not_found" });
  });

  it("mantém o resumo em cache atualizado e o invalida na conclusão", async () => {
    const { client, channel } = setup();
    client.setQueryData<AuditSummary>(queryKeys.audit(AUDIT_ID), auditSummary({ revision: 1 }));
    act(() => channel().reply({ revision: 1, progress: progress() }));
    act(() => channel().push("page_scanned", scanned(2, { pages_scanned: 1 })));
    await advance(BATCH_MS);
    const cached = client.getQueryData<AuditSummary>(queryKeys.audit(AUDIT_ID));
    expect(cached).toMatchObject({ revision: 2, pages_scanned: 1, start_url: "https://exemplo.com.br/" });
    expect(client.getQueryState(queryKeys.audit(AUDIT_ID))?.isInvalidated).toBe(false);

    act(() => channel().push("audit_completed", { revision: 3, progress: progress({ status: "completed" }), score: null }));
    await advance(BATCH_MS);
    expect(client.getQueryState(queryKeys.audit(AUDIT_ID))?.isInvalidated).toBe(true);
  });

  it("ignora payload sem revision ou progress", async () => {
    const { result, channel } = setup();
    act(() => channel().reply({ revision: 1, progress: progress() }));
    act(() => {
      channel().push("page_scanned", { page_id: PAGE_ID });
      channel().push("status_changed", null);
    });
    await advance(BATCH_MS);
    expect(result.current.revision).toBe(1);
    expect(result.current.pages).toEqual([]);
  });

  it("ao desmontar sai do canal e para os timers", async () => {
    const { channel, unmount } = setup();
    act(() => channel().reply({ revision: 1, progress: progress() }));
    unmount();
    expect(channel().left).toBe(true);
    await advance(SILENCE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trocar de auditoria sai do canal antigo e começa do zero no novo", () => {
    const other = "11111111-2222-4333-8444-555555555555";
    const { socket, result, rerender } = setup();
    act(() => socket.last.reply({ revision: 3, progress: progress() }));
    const first = socket.last;
    rerender({ id: other });
    expect(first.left).toBe(true);
    expect(socket.last.topic).toBe(`audit:${other}`);
    expect(result.current.progress).toBeNull();
  });
});
