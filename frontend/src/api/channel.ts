// Progresso em tempo real pelo canal Phoenix `audit:<id>` (RF-RA004, PRD §9). Regras do
// cliente, do `$comment` de shared/channel-events.schema.json:
//   1. o estado é o `progress` de maior `revision` (join, evento ou `GET /api/audits/:id`);
//      os campos próprios do evento (`page_id`) valem sempre, mesmo fora de ordem;
//   2. a conclusão é anunciada quando o status local passa de não final a final, uma vez só,
//      venha a mudança de onde vier (inclusive do snapshot de uma reconexão);
//   3. com a auditoria aberta e 30 s sem nenhum evento, busca `GET /api/audits/:id`;
//   4. os eventos são agregados em lotes de 500 ms (um render por lote).
// A reconexão e o novo join são do cliente `phoenix`; o snapshot do novo join passa pela
// regra 1. O hook devolve o estado e o anúncio; a região `aria-live` fica na tela.
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Socket } from "phoenix";
import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { totalProblems } from "../severity";
import { CHANNEL_EVENTS, type AuditChannelEvent } from "./channel.gen";
import { ApiError, getAudit, isApiError } from "./client";
import { queryKeys } from "./queryKeys";
import type { AuditStatus, AuditSummary, ChannelProgress, PageError, SeverityCounts } from "./types";

export const BATCH_MS = 500;
export const SILENCE_MS = 30_000;

const FINAL_STATUSES: ReadonlySet<AuditStatus> = new Set(["completed", "failed", "cancelled"]);

export function isFinalStatus(status: AuditStatus): boolean {
  return FINAL_STATUSES.has(status);
}

// --- Socket ------------------------------------------------------------------------------
// O mínimo do cliente `phoenix` que o hook usa: nos testes entra um socket falso.

export interface PushLike {
  receive(status: string, callback: (response?: unknown) => void): PushLike;
}

export interface ChannelLike {
  join(timeout?: number): PushLike;
  leave(timeout?: number): PushLike;
  on(event: string, callback: (payload?: unknown) => void): number;
  onError(callback: (reason?: unknown) => void): number;
}

export interface SocketLike {
  channel(topic: string, params?: object): ChannelLike;
}

let sharedSocket: Socket | null = null;

/** Um socket só para o app inteiro (`/socket`, só websocket), conectado no primeiro uso. */
function defaultSocket(): SocketLike {
  if (sharedSocket === null) {
    sharedSocket = new Socket("/socket");
    sharedSocket.connect();
  }
  return sharedSocket;
}

const SocketContext = createContext<() => SocketLike>(defaultSocket);

/** Troca o socket do canal (testes). Sem o provider, o app usa o socket compartilhado. */
export function AuditSocketProvider({ socket, children }: { socket: SocketLike; children: ReactNode }) {
  const [get] = useState(() => () => socket);
  return createElement(SocketContext.Provider, { value: get }, children);
}

// --- Estado ------------------------------------------------------------------------------

export type ConnectionState = "connecting" | "open" | "reconnecting";

export type PageActivity =
  | { pageId: string; kind: "scanned"; counts: SeverityCounts; needsReviewCount: number }
  | { pageId: string; kind: "failed"; error: PageError };

export interface AuditChannelState {
  /** `revision` do `progress` atual; `null` antes do primeiro snapshot. */
  revision: number | null;
  progress: ChannelProgress | null;
  connection: ConnectionState;
  /** Join recusado (`audit_not_found`, `channel_limit_reached`): o canal para de tentar. */
  error: ApiError | null;
  /** Páginas terminadas, na ordem de chegada (para o feed de atividade da tela). */
  pages: PageActivity[];
  /** Texto para a região viva: a conclusão, uma vez só. `null` até lá. */
  announcement: string | null;
}

export const initialChannelState: AuditChannelState = {
  revision: null,
  progress: null,
  connection: "connecting",
  error: null,
  pages: [],
  announcement: null,
};

/** Um snapshot recebido (join, evento ou GET), com a página quando o evento é de página. */
export interface Incoming {
  revision: number;
  progress: ChannelProgress;
  page?: PageActivity;
}

function announcementFor(progress: ChannelProgress): string {
  switch (progress.status) {
    case "completed":
      return t.channel.completed(totalProblems(progress.totals_by_severity), progress.pages_scanned, progress.pages_failed);
    case "failed":
      return t.channel.failed(progress.error?.message ?? null);
    default:
      return t.channel.cancelled;
  }
}

/** Aplica um lote ao estado (regras 1 e 2). Pura: os testes a usam direto. */
export function applyBatch(state: AuditChannelState, batch: readonly Incoming[]): AuditChannelState {
  let revision = state.revision;
  let progress = state.progress;
  let pages = state.pages;

  for (const item of batch) {
    if (item.page) {
      const page = item.page;
      const index = pages.findIndex((p) => p.pageId === page.pageId && p.kind === page.kind);
      pages = index === -1 ? [...pages, page] : pages.map((p, i) => (i === index ? page : p));
    }
    if (revision === null || item.revision > revision) {
      revision = item.revision;
      progress = item.progress;
    }
  }

  const becameFinal =
    state.progress !== null && !isFinalStatus(state.progress.status) && progress !== null && isFinalStatus(progress.status);
  const announcement = state.announcement ?? (becameFinal && progress ? announcementFor(progress) : null);

  if (revision === state.revision && pages === state.pages && announcement === state.announcement) return state;
  return { ...state, revision, progress, pages, announcement };
}

// --- Payloads ----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// O backend confere cada payload contra o schema; aqui só se descarta o que nem tem a forma
// básica (revision e progress), para um payload estranho não derrubar a tela.
function toIncoming(event: AuditChannelEvent | "join", payload: unknown): Incoming | null {
  if (!isRecord(payload) || typeof payload["revision"] !== "number" || !isRecord(payload["progress"])) return null;
  const incoming: Incoming = { revision: payload["revision"], progress: payload["progress"] as unknown as ChannelProgress };
  const pageId = payload["page_id"];
  if (typeof pageId === "string") {
    if (event === "page_scanned") {
      incoming.page = {
        pageId,
        kind: "scanned",
        counts: payload["counts_by_severity"] as SeverityCounts,
        needsReviewCount: payload["needs_review_count"] as number,
      };
    } else if (event === "page_failed") {
      incoming.page = { pageId, kind: "failed", error: payload["error"] as PageError };
    }
  }
  return incoming;
}

function fromSummary(summary: AuditSummary): Incoming {
  const { status, pages_found, pages_scanned, pages_failed, totals_by_severity, needs_review_count, error } = summary;
  return {
    revision: summary.revision,
    progress: { status, pages_found, pages_scanned, pages_failed, totals_by_severity, needs_review_count, error },
  };
}

function joinError(response: unknown): ApiError {
  const error = isRecord(response) && isRecord(response["error"]) ? response["error"] : {};
  const code = typeof error["code"] === "string" ? error["code"] : "audit_not_found";
  const message = typeof error["message"] === "string" ? error["message"] : t.errors.audit_not_found;
  return new ApiError(code, message, 0);
}

// Mantém o resumo em cache (`useAudit`) com o `progress` mais novo, sem refazer o GET a cada
// evento (PRD §9: o top 5 é recalculado no GET; o canal já leva os contadores).
function syncAuditCache(client: QueryClient, auditId: string, revision: number, progress: ChannelProgress) {
  client.setQueryData<AuditSummary>(queryKeys.audit(auditId), (old) =>
    old && revision > old.revision ? { ...old, ...progress, revision } : old,
  );
}

// --- Hook --------------------------------------------------------------------------------

/**
 * Acompanha a auditoria pelo canal `audit:<id>`. Devolve o progresso (com a maior `revision`
 * recebida), o estado da conexão, as páginas terminadas e o anúncio de conclusão.
 */
export function useAuditChannel(auditId: string): AuditChannelState {
  const getSocket = useContext(SocketContext);
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState<{ auditId: string; state: AuditChannelState }>({
    auditId,
    state: initialChannelState,
  });
  const stateRef = useRef(initialChannelState);

  useEffect(() => {
    let active = true;
    let buffer: Incoming[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    stateRef.current = initialChannelState;

    const commit = (next: AuditChannelState) => {
      if (!active || next === stateRef.current) return;
      const previous = stateRef.current;
      stateRef.current = next;
      setSnapshot({ auditId, state: next });
      if (next.progress && next.revision !== null && next.revision !== previous.revision) {
        syncAuditCache(queryClient, auditId, next.revision, next.progress);
      }
      // Fim da auditoria: resumo (top 5), páginas e achados são lidos de novo, uma vez.
      if (next.announcement !== null && previous.announcement === null) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.audit(auditId) });
      }
    };

    const flush = () => {
      flushTimer = null;
      const batch = buffer;
      buffer = [];
      commit(applyBatch(stateRef.current, batch));
    };

    const scheduleSilenceCheck = () => {
      if (silenceTimer !== null) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(checkSilence, SILENCE_MS);
    };

    const receive = (incoming: Incoming | null) => {
      if (!active) return;
      scheduleSilenceCheck();
      if (incoming === null) return;
      buffer.push(incoming);
      // Sem nada na tela ainda, o primeiro snapshot entra na hora; o resto espera o lote.
      if (stateRef.current.progress === null) {
        if (flushTimer !== null) clearTimeout(flushTimer);
        flush();
      } else if (flushTimer === null) {
        flushTimer = setTimeout(flush, BATCH_MS);
      }
    };

    // Regra 3: 30 s sem evento com a auditoria em andamento → GET. Encerrada, não há mais
    // evento a esperar.
    function checkSilence() {
      silenceTimer = null;
      const { progress, error } = stateRef.current;
      if (!active || error !== null || (progress !== null && isFinalStatus(progress.status))) return;
      queryClient
        .fetchQuery({
          queryKey: queryKeys.audit(auditId),
          queryFn: ({ signal }) => getAudit(auditId, { signal }),
          staleTime: 0,
        })
        .then((summary) => receive(fromSummary(summary)))
        .catch((cause: unknown) => {
          if (!active) return;
          if (isApiError(cause) && cause.code === "audit_not_found") {
            commit({ ...stateRef.current, error: cause });
          } else {
            scheduleSilenceCheck();
          }
        });
    }

    const channel = getSocket().channel(`audit:${auditId}`, {});
    for (const event of CHANNEL_EVENTS) {
      channel.on(event, (payload) => receive(toIncoming(event, payload)));
    }
    channel.onError(() => {
      if (stateRef.current.connection !== "reconnecting") commit({ ...stateRef.current, connection: "reconnecting" });
    });
    channel
      .join()
      .receive("ok", (reply) => {
        if (!active) return;
        if (stateRef.current.connection !== "open") commit({ ...stateRef.current, connection: "open" });
        receive(toIncoming("join", reply));
      })
      .receive("error", (response) => {
        if (!active) return;
        // Auditoria inexistente ou limite de canais: tentar de novo não muda a resposta.
        channel.leave();
        commit({ ...stateRef.current, error: joinError(response) });
        if (silenceTimer !== null) clearTimeout(silenceTimer);
      })
      .receive("timeout", () => {
        if (active && stateRef.current.connection === "open") commit({ ...stateRef.current, connection: "reconnecting" });
      });
    scheduleSilenceCheck();

    return () => {
      active = false;
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (silenceTimer !== null) clearTimeout(silenceTimer);
      channel.leave();
    };
  }, [auditId, getSocket, queryClient]);

  return snapshot.auditId === auditId ? snapshot.state : initialChannelState;
}
