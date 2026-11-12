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
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Socket } from "phoenix";
import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { totalProblems } from "../severity";
import { CHANNEL_EVENTS, CHANNEL_TOPIC, type AuditChannelEvent } from "./channel.gen";
import { ApiError, getAudit, isApiError, listPages } from "./client";
import { isRecord } from "./json";
import { queryKeys } from "./queryKeys";
import type {
  AuditStatus,
  AuditSummary,
  ChannelProgress,
  FindingsPage,
  PageError,
  PageSummary,
  SeverityCounts,
} from "./types";

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

/**
 * Um `progress` recebido, com a origem (`join` e `get` são snapshots) e a página quando o
 * evento é de página.
 */
export interface Incoming {
  revision: number;
  progress: ChannelProgress;
  source: "event" | "join" | "get";
  page?: PageActivity;
}

/** Páginas que já terminaram segundo o `progress` (analisadas mais as com falha). */
export function finishedPages(progress: ChannelProgress): number {
  return progress.pages_scanned + progress.pages_failed;
}

function activityFromSummary(page: PageSummary): PageActivity[] {
  switch (page.status) {
    case "analyzing":
    case "done":
      return [{ pageId: page.id, kind: "scanned", counts: page.counts_by_severity, needsReviewCount: page.needs_review_count }];
    case "failed":
      return [
        { pageId: page.id, kind: "failed", error: page.error ?? { code: "internal_error", message: t.errors.internal_error } },
      ];
    default:
      return [];
  }
}

/**
 * Completa o feed com as páginas terminadas da lista da API (`GET /api/audits/:id/pages`),
 * para ele não contradizer o contador depois de eventos perdidos (queda, publicação que
 * falhou). O que já está no feed fica na ordem de chegada; o resto entra na ordem da lista.
 */
export function mergePages(feed: readonly PageActivity[], list: readonly PageSummary[]): PageActivity[] {
  const known = new Set(feed.map((p) => p.pageId));
  const added = list.filter((p) => !known.has(p.id)).flatMap(activityFromSummary);
  return added.length === 0 ? (feed as PageActivity[]) : [...feed, ...added];
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

// O backend confere cada payload contra o schema; aqui só se descarta o que nem tem a forma
// básica (revision e progress), para um payload estranho não derrubar a tela.
function toIncoming(event: AuditChannelEvent | "join", payload: unknown): Incoming | null {
  if (!isRecord(payload) || typeof payload["revision"] !== "number" || !isRecord(payload["progress"])) return null;
  const incoming: Incoming = {
    revision: payload["revision"],
    progress: payload["progress"] as unknown as ChannelProgress,
    source: event === "join" ? "join" : "event",
  };
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
    source: "get",
  };
}

function joinError(response: unknown): ApiError {
  const error = isRecord(response) && isRecord(response["error"]) ? response["error"] : {};
  const code = typeof error["code"] === "string" ? error["code"] : "audit_not_found";
  const message = typeof error["message"] === "string" ? error["message"] : t.errors.audit_not_found;
  return new ApiError(code, message, 0);
}

export function auditTopic(auditId: string): string {
  return CHANNEL_TOPIC.replace("<id>", auditId);
}

// --- Hook --------------------------------------------------------------------------------

/**
 * Acompanha a auditoria pelo canal `audit:<id>`. Devolve o progresso (com a maior `revision`
 * recebida), o estado da conexão, as páginas terminadas e o anúncio de conclusão.
 *
 * Cache do resumo (`useAudit`): o canal não escreve nele. O resumo é uma foto de uma
 * `revision` (totais, revisão por severidade, top 5, datas); misturar nele o `progress` do
 * canal deixaria campos de instantes diferentes lado a lado. Quando o canal passa à frente,
 * o resumo só é marcado como velho (sem buscar de novo); no fim da auditoria ele é buscado
 * uma vez. Durante o andamento, os contadores ao vivo vêm deste hook.
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
    let left = false;
    let rebuilding = false;
    let buffer: Incoming[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    stateRef.current = initialChannelState;

    const commit = (next: AuditChannelState) => {
      if (!active || next === stateRef.current) return;
      stateRef.current = next;
      setSnapshot({ auditId, state: next });
    };

    // Fim da auditoria: o resumo (top 5, datas), a lista de páginas e, se houve página
    // analisada, a primeira página de cada lista de achados aberta são lidos de novo, uma vez.
    const refreshAfterEnd = (progress: ChannelProgress, summaryIsFresh: boolean) => {
      if (!summaryIsFresh) void queryClient.invalidateQueries({ queryKey: queryKeys.audit(auditId), exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages(auditId), exact: true });
      if (progress.status === "failed" || progress.pages_scanned === 0) return;
      // Só a primeira página: as de cursor já carregadas não são buscadas de novo.
      queryClient.setQueriesData<InfiniteData<FindingsPage, string | null>>(
        { queryKey: queryKeys.findingsAll(auditId) },
        (data) =>
          data && data.pages.length > 1
            ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
            : data,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.findingsAll(auditId), refetchType: "active" });
    };

    // Regra do feed: um snapshot (join ou GET) com mais páginas terminadas do que o feed
    // conhece quer dizer que eventos se perderam; o feed é completado pela lista de páginas.
    const rebuildFeed = () => {
      if (rebuilding) return;
      rebuilding = true;
      queryClient
        .fetchQuery({
          queryKey: queryKeys.pages(auditId),
          queryFn: ({ signal }) => listPages(auditId, { signal }),
          staleTime: 0,
        })
        .then((list) => commit({ ...stateRef.current, pages: mergePages(stateRef.current.pages, list.data) }))
        .catch(() => undefined) // o próximo snapshot tenta de novo
        .finally(() => {
          rebuilding = false;
        });
    };

    const flush = () => {
      flushTimer = null;
      const batch = buffer;
      buffer = [];
      const previous = stateRef.current;
      const next = applyBatch(previous, batch);
      commit(next);
      if (next.progress === null || next.revision === null) return;

      const advanced = next.revision !== previous.revision;
      const fromGet = batch.some((item) => item.source === "get" && item.revision === next.revision);
      if (advanced && !fromGet) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.audit(auditId), exact: true, refetchType: "none" });
      }
      if (next.announcement !== null && previous.announcement === null) refreshAfterEnd(next.progress, fromGet);

      const snapshotInBatch = batch.some((item) => item.source !== "event");
      if (snapshotInBatch && finishedPages(next.progress) > next.pages.length) rebuildFeed();
    };

    const scheduleSilenceCheck = () => {
      if (silenceTimer !== null) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(checkSilence, SILENCE_MS);
    };

    const receive = (incoming: Incoming | null) => {
      // Payload descartado não conta como evento: não adia o GET de silêncio.
      if (!active || incoming === null) return;
      scheduleSilenceCheck();
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

    const channel = getSocket().channel(auditTopic(auditId), {});
    const leave = () => {
      if (left) return;
      left = true;
      channel.leave();
    };
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
        leave();
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
      leave();
    };
  }, [auditId, getSocket, queryClient]);

  return snapshot.auditId === auditId ? snapshot.state : initialChannelState;
}
