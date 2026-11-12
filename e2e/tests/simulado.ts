// API e canal simulados para os E2E das telas (`make e2e`): o build do frontend roda sozinho
// (vite preview), então `/api` é respondido por `page.route` e o websocket `/socket` por
// `page.routeWebSocket`, falando o protocolo do cliente `phoenix` (serializador V2, JSON:
// `[join_ref, ref, topic, event, payload]`). Os formatos seguem os contratos
// (`shared/openapi.json` e `shared/channel-events.schema.json`).
import type { Page, WebSocketRoute } from "@playwright/test";

export const AUDIT_ID = "3f2b8c1e-7a4d-4e5f-9b0c-1d2e3f4a5b6c";
export const PAGE_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOPIC = `audit:${AUDIT_ID}`;

type Status = "queued" | "running" | "completed" | "failed" | "cancelled";
type Totals = { critical: number; serious: number; moderate: number; minor: number };

export interface Progress {
  status: Status;
  pages_found: number;
  pages_scanned: number;
  pages_failed: number;
  totals_by_severity: Totals;
  needs_review_count: number;
  error: { code: string; message: string } | null;
}

export const ZERO: Totals = { critical: 0, serious: 0, moderate: 0, minor: 0 };

export function progress(overrides: Partial<Progress> = {}): Progress {
  return {
    status: "running",
    pages_found: 1,
    pages_scanned: 0,
    pages_failed: 0,
    totals_by_severity: ZERO,
    needs_review_count: 0,
    error: null,
    ...overrides,
  };
}

export function summary(revision: number, p: Progress, startUrl = "https://exemplo.com.br/") {
  return {
    id: AUDIT_ID,
    revision,
    start_url: startUrl,
    page_limit: 1,
    ...p,
    needs_review_by_severity: ZERO,
    score: null,
    top_issues: [],
    inserted_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: p.status === "completed" || p.status === "failed" ? new Date().toISOString() : null,
  };
}

/** Responde `GET /api/audits/:id` e `/pages` com o estado atual (mutável pelo teste). */
export async function mockAuditApi(page: Page, state: { revision: number; progress: Progress }) {
  await page.route(`**/api/audits/${AUDIT_ID}`, (route) =>
    route.fulfill({ json: summary(state.revision, state.progress) }),
  );
  await page.route(`**/api/audits/${AUDIT_ID}/pages`, (route) => route.fulfill({ json: { data: [] } }));
}

/**
 * Servidor Phoenix falso: responde heartbeat e join (com o snapshot de `state`), e deixa o
 * teste empurrar eventos e derrubar a conexão (o cliente reconecta e faz um novo join).
 */
export class PhoenixMock {
  private sockets: WebSocketRoute[] = [];
  private joinRef: string | null = null;
  joins = 0;
  /** Enquanto `false`, o join fica sem resposta (canal "conectando"). */
  answerJoins = true;

  constructor(readonly state: { revision: number; progress: Progress }) {}

  async install(page: Page) {
    await page.routeWebSocket(/\/socket\/websocket/, (ws) => {
      this.sockets.push(ws);
      ws.onMessage((raw) => {
        const [joinRef, ref, topic, event] = JSON.parse(String(raw)) as [string | null, string, string, string, unknown];
        if (topic === "phoenix" && event === "heartbeat") {
          ws.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
        } else if (topic === TOPIC && event === "phx_join") {
          this.joinRef = joinRef;
          this.joins += 1;
          if (this.answerJoins) {
            const response = { revision: this.state.revision, progress: this.state.progress };
            ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response }]));
          }
        } else if (event === "phx_leave") {
          ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
        }
      });
    });
  }

  /** Atualiza o estado (visto pelo próximo join e pelo GET) e empurra o evento. */
  push(event: string, revision: number, p: Progress, extra: Record<string, unknown> = {}) {
    this.state.revision = revision;
    this.state.progress = p;
    const ws = this.sockets.at(-1);
    ws?.send(JSON.stringify([this.joinRef, null, TOPIC, event, { revision, progress: p, ...extra }]));
  }

  /** Muda o estado sem avisar o cliente (eventos perdidos durante uma queda). */
  silently(revision: number, p: Progress) {
    this.state.revision = revision;
    this.state.progress = p;
  }

  /** Derruba a conexão; o cliente `phoenix` reconecta sozinho. */
  async drop() {
    await this.sockets.at(-1)?.close({ code: 1011, reason: "queda simulada" });
  }
}

/** Grava, dentro da página, cada texto novo da região viva (`role="status"` com aria-live). */
export async function recordLiveRegion(page: Page) {
  await page.evaluate(() => {
    const said: string[] = [];
    (window as unknown as { __said: string[] }).__said = said;
    const watch = () => {
      const region = document.querySelector('[aria-live="polite"][role="status"]');
      if (!region) return false;
      new MutationObserver(() => {
        const text = region.textContent ?? "";
        if (text !== "" && said.at(-1) !== text) said.push(text);
      }).observe(region, { childList: true, characterData: true, subtree: true });
      return true;
    };
    if (!watch()) throw new Error("sem região viva na tela");
  });
}

export function liveRegionTexts(page: Page) {
  return page.evaluate(() => (window as unknown as { __said: string[] }).__said);
}

// Espaçamento de texto do critério 1.4.12 (o mesmo do bookmarklet).
export const TEXT_SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
