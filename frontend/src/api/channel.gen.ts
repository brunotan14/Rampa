// Gerado por `make api-types` a partir de shared/channel-events.schema.json.
// Não edite à mão: mude o schema e gere de novo.

/**
 * Versão do andamento da auditoria. Sobe a cada transição gravada, na ordem de commit; eventos da mesma transição têm a mesma. É a mesma do campo `revision` de `GET /api/audits/:id`.
 */
export type Revision = number;
export type AuditStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type Uuid = string;

/**
 * Payload de cada evento do canal `audit:<id>` (`x-events`) e das respostas do join (`x-join`).
 */
export interface AuditChannelPayloads {
  join_reply: JoinReply;
  join_error: JoinError;
  audit_completed: AuditCompleted;
  audit_failed: AuditFailed;
  page_failed: PageFailed;
  page_scanned: PageScanned;
  status_changed: StatusChanged;
}
/**
 * Resposta do join: o snapshot atual, lido depois de o canal se inscrever nos eventos. Evento com `revision` menor ou igual à do snapshot não é enviado.
 */
export interface JoinReply {
  revision: Revision;
  progress: Progress;
}
/**
 * Estado absoluto da auditoria (não é delta), com os mesmos nomes de `GET /api/audits/:id`. No M2 a etapa atual é derivada do `status` (`queued` ou `running`: varredura automática); o campo `stage` entra no M4.
 */
export interface Progress {
  status: AuditStatus;
  pages_found: number;
  pages_scanned: number;
  pages_failed: number;
  totals_by_severity: SeverityCounts;
  /**
   * Achados que pedem confirmação manual (IA, heurística, incompletos do axe).
   */
  needs_review_count: number;
  /**
   * Por que a auditoria falhou; `null` enquanto não falhou.
   */
  error: null | PageError;
}
/**
 * Achados confirmados (`needs_review = false`) por severidade, com os nomes do axe.
 */
export interface SeverityCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}
/**
 * Erro de página ou de auditoria, com a mensagem em português pronta para exibir e, quando houver, o status HTTP da página. Os códigos são os de `pages.error` e `audits.error` (`Rampa.ErrorCodes.page/0`).
 */
export interface PageError {
  code:
    | "invalid_url"
    | "unsupported_scheme"
    | "blocked_address"
    | "unresolvable"
    | "dns_error"
    | "resource_limit"
    | "timeout"
    | "http_error"
    | "navigation_failed"
    | "analysis_failed"
    | "invalid_request"
    | "unavailable"
    | "contract_mismatch"
    | "invalid_scan_result"
    | "internal_error"
    | "stale"
    | "scan_failed";
  message: string;
  /**
   * Status HTTP da página que falhou (RF-RA029), quando o site respondeu com erro (`http_error`). Ausente quando não há status. A `message` já o cita. Opcional, acrescentado sem subir a versão.
   */
  http_status?: number;
}
/**
 * Recusa do join, no formato de erro da API. `audit_not_found`: id que não é um UUID em minúsculas ou auditoria inexistente (mesma resposta para os dois). `channel_limit_reached`: a conexão já acompanha o máximo de auditorias.
 */
export interface JoinError {
  error: {
    code: "audit_not_found" | "channel_limit_reached";
    message: string;
  };
}
/**
 * A auditoria entrou em `completed`. Os totais estão em `progress`. `score` é `null` até o M3.
 */
export interface AuditCompleted {
  revision: Revision;
  progress: Progress;
  score: number | null;
}
/**
 * A auditoria entrou em `failed`: nenhuma página foi varrida. O motivo está em `progress.error`.
 */
export interface AuditFailed {
  revision: Revision;
  progress: Progress;
}
/**
 * A página passou a `failed` (a varredura falhou). Falha de uma análise de IA não falha a página e não gera este evento.
 */
export interface PageFailed {
  revision: Revision;
  progress: Progress;
  page_id: Uuid;
  error: PageError;
}
/**
 * A varredura automática de uma página terminou (a página saiu de `queued` ou `scanning` para `analyzing` ou `done`). As contagens são só desta página.
 */
export interface PageScanned {
  revision: Revision;
  progress: Progress;
  page_id: Uuid;
  counts_by_severity: SeverityCounts;
  needs_review_count: number;
}
/**
 * A auditoria passou de `queued` a `running`. A entrada em estado final sai como `audit_completed` ou `audit_failed`.
 */
export interface StatusChanged {
  revision: Revision;
  progress: Progress;
  status: "running";
}

// `x-channel-version`: sobe só em mudança incompatível do canal.
export const CHANNEL_VERSION = "1" as const;

// Tópico do canal (`x-topic`), com `<id>` no lugar do id da auditoria.
export const CHANNEL_TOPIC = "audit:<id>" as const;

// Eventos do canal (`x-events`). O cliente ignora evento que não está aqui.
export const CHANNEL_EVENTS = [
  "audit_completed",
  "audit_failed",
  "page_failed",
  "page_scanned",
  "status_changed"
] as const satisfies readonly (keyof AuditChannelPayloads)[];

export type AuditChannelEvent = (typeof CHANNEL_EVENTS)[number];
