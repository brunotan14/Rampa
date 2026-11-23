// Auditorias recentes deste navegador (RF-RA018). Ficam só no `localStorage`: nada desta lista
// vai para o servidor. A tela da auditoria grava (`recordRecent`) e a tela inicial só atualiza o
// status (`updateRecentStatus`) ou tira o que a API diz que não existe mais (`removeRecent`).
//
// Tolerante a falha: sem armazenamento (navegação privada, bloqueio do navegador), com dados
// corrompidos ou de outra versão, a lista fica vazia e nada lança exceção. Tudo o que vem do
// armazenamento é validado na leitura, porque qualquer script da mesma origem ou extensão pode
// escrever lá.
import type { AuditStatus } from "./api/types";
import { hostOf, isAuditId, pathOf } from "./report";

export interface RecentAudit {
  id: string;
  /** Endereço auditado, como a API devolveu (`start_url`). */
  startUrl: string;
  /** Criação da auditoria (`inserted_at`): é a data mostrada no item. */
  createdAt: string;
  /** Último status conhecido; a tela inicial busca o atual. */
  status: AuditStatus;
  /** Última vez que a auditoria foi aberta neste navegador: define a ordem da lista. */
  lastOpenedAt: string;
}

export const RECENT_KEY = "rampa.recentAudits.v1";
const VERSION = 1;
export const MAX_RECENT = 10;
/** Mesmo teto de endereço da API (RF-RA001). */
const MAX_URL_LENGTH = 2048;

// Os 5 status do contrato: o `Record` obriga a revisar esta lista se o contrato mudar.
const STATUSES: Record<AuditStatus, true> = {
  queued: true,
  running: true,
  completed: true,
  failed: true,
  cancelled: true,
};

function isAuditStatus(value: unknown): value is AuditStatus {
  return typeof value === "string" && Object.hasOwn(STATUSES, value);
}

// Data e hora ISO 8601 com fuso (como a API manda: `2026-11-12T10:00:00Z`).
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown): RecentAudit | null {
  if (!isRecord(value)) return null;
  const { id, startUrl, createdAt, status, lastOpenedAt } = value;
  if (typeof id !== "string" || !isAuditId(id)) return null;
  if (!isWebUrl(startUrl) || !isIsoDate(createdAt) || !isIsoDate(lastOpenedAt) || !isAuditStatus(status)) return null;
  // Só os campos conhecidos: nada além disso volta a ser gravado.
  return { id, startUrl, createdAt, status, lastOpenedAt };
}

/** Mais recente primeiro, pela última abertura; a posição no array guardado não importa. */
function byLastOpened(a: RecentAudit, b: RecentAudit): number {
  return Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
}

// O próprio acesso a `window.localStorage` pode lançar (SecurityError com cookies bloqueados).
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A lista guardada, já validada, ordenada e com no máximo `MAX_RECENT` itens. */
export function readRecent(): RecentAudit[] {
  let raw: string | null;
  try {
    raw = storage()?.getItem(RECENT_KEY) ?? null;
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.version !== VERSION || !Array.isArray(parsed.items)) return [];
  const seen = new Set<string>();
  const items: RecentAudit[] = [];
  for (const value of parsed.items) {
    const item = parseItem(value);
    if (item === null || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items.sort(byLastOpened).slice(0, MAX_RECENT);
}

function write(items: readonly RecentAudit[]): void {
  try {
    storage()?.setItem(RECENT_KEY, JSON.stringify({ version: VERSION, items: [...items].sort(byLastOpened).slice(0, MAX_RECENT) }));
  } catch {
    // Sem espaço ou sem permissão: a lista é um recurso secundário, a tela segue.
  }
}

/**
 * Grava a auditoria aberta (só a tela da auditoria chama): sobe para o topo, com
 * `lastOpenedAt` = agora, e a lista fica com no máximo `MAX_RECENT` itens. Item inválido é
 * ignorado.
 */
export function recordRecent(item: Omit<RecentAudit, "lastOpenedAt">, now: Date = new Date()): void {
  const next = parseItem({ ...item, lastOpenedAt: now.toISOString() });
  if (next === null) return;
  write([next, ...readRecent().filter((recent) => recent.id !== next.id)]);
}

/** Troca só o status: não mexe na ordem nem em `lastOpenedAt`. Id fora da lista: nada muda. */
export function updateRecentStatus(id: string, status: AuditStatus): void {
  if (!isAuditStatus(status)) return;
  const items = readRecent();
  const current = items.find((item) => item.id === id);
  if (current === undefined || current.status === status) return;
  write(items.map((item) => (item.id === id ? { ...item, status } : item)));
}

export function removeRecent(id: string): void {
  const items = readRecent();
  if (!items.some((item) => item.id === id)) return;
  write(items.filter((item) => item.id !== id));
}

export function clearRecent(): void {
  try {
    storage()?.removeItem(RECENT_KEY);
  } catch {
    // idem `write`
  }
}

// Caracteres de controle (C0, DEL, C1), de direção do texto (marcas e embutimentos bidi), de
// largura zero (U+200B–U+200D, U+FEFF) e separadores de linha e parágrafo (U+2028, U+2029), que
// poderiam esconder, inverter ou disfarçar o endereço mostrado.
// eslint-disable-next-line no-control-regex -- casar caracteres de controle é o objetivo
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2028\u2029\ufeff؜‎‏‪-‮⁦-⁩]/g;

/** Texto sem caracteres de controle nem de direção bidi, para exibir. */
export function safeText(value: string): string {
  return value.replace(UNSAFE_TEXT, "");
}

/**
 * Endereço do item para exibir: host e caminho, com acentos legíveis ("exemplo.com.br/serviços"),
 * sem o esquema e sem a barra final da raiz.
 */
export function recentLabel(startUrl: string): string {
  const host = hostOf(startUrl);
  if (host === null) return safeText(startUrl);
  const path = pathOf(startUrl);
  // Raiz sem a barra: "exemplo.com.br" e "exemplo.com.br?q=1".
  const rest = path === "/" || path.startsWith("/?") ? path.slice(1) : path;
  let readable = rest;
  try {
    readable = decodeURI(rest);
  } catch {
    // sequência % inválida: fica a forma codificada
  }
  return safeText(`${host}${readable}`);
}
