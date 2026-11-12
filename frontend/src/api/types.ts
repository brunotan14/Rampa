// Módulo único dos tipos da API e do canal, derivados dos contratos gerados
// (`schema.gen.ts` de shared/openapi.json e `channel.gen.ts` de
// shared/channel-events.schema.json). Nenhum tipo de payload é escrito à mão: o resto do
// frontend importa daqui.
import type { components, operations } from "./schema.gen";
import type { AuditChannelPayloads, JoinError, Progress } from "./channel.gen";

type Schemas = components["schemas"];

export type AuditSummary = Schemas["AuditSummary"];
export type AuditStatus = AuditSummary["status"];
export type AuditError = NonNullable<Schemas["AuditError"]>;
export type TopIssue = Schemas["TopIssue"];
export type SeverityTotals = Schemas["SeverityTotals"];
export type PageSummary = Schemas["PageSummary"];
export type PagesList = Schemas["PagesList"];
export type PageDetail = Schemas["PageDetail"];
export type PassedRule = Schemas["PassedRule"];
export type Finding = Schemas["Finding"];
export type FindingDetail = Schemas["FindingDetail"];
export type FindingsPage = Schemas["FindingsPage"];
export type CreateAuditRequest = Schemas["CreateAuditRequest"];
export type CreateAuditResponse = Schemas["CreateAuditResponse"];

/** Severidade com os nomes do axe, como a API manda. Na interface, ver `src/severity.ts`. */
export type ApiSeverity = Finding["severity"];
export type FindingSource = Finding["source"];

/** Filtros e ordem de `GET /api/audits/:id/findings`, sem o `cursor` (a paginação é do hook). */
export type FindingsFilters = Omit<NonNullable<operations["listFindings"]["parameters"]["query"]>, "cursor">;

// Todo schema de erro da API tem a forma `{ error: { code, message } }`: a união dos códigos
// sai dos próprios schemas, então código novo na API entra aqui ao regenerar os tipos.
type ErrorBodies = Extract<Schemas[keyof Schemas], { error: { code: string; message: string } }>;
export type ApiErrorCode = ErrorBodies["error"]["code"] | JoinError["error"]["code"];

/** Erros que nascem no próprio cliente, sem resposta da API. */
export type ClientErrorCode = "network_error" | "unexpected_response";

export type KnownErrorCode = ApiErrorCode | ClientErrorCode;

// Canal `audit:<id>`.
export type { AuditChannelPayloads, JoinError, JoinReply, PageError, Progress, SeverityCounts } from "./channel.gen";
export type ChannelProgress = Progress;
export type PageScannedEvent = AuditChannelPayloads["page_scanned"];
export type PageFailedEvent = AuditChannelPayloads["page_failed"];
