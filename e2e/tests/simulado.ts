// API e canal simulados para os E2E das telas (`make e2e`): o build do frontend roda sozinho
// (vite preview), então `/api` é respondido por `page.route` e o websocket `/socket` por
// `page.routeWebSocket`, falando o protocolo do cliente `phoenix` (serializador V2, JSON:
// `[join_ref, ref, topic, event, payload]`). Os formatos seguem os contratos
// (`shared/openapi.json` e `shared/channel-events.schema.json`).
import type { Page, Route, WebSocketRoute } from "@playwright/test";
import type { components } from "../../frontend/src/api/schema.gen.js";

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
  error: { code: string; message: string; http_status?: number } | null;
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
    login_wall_pages: 0,
    score: null,
    top_issues: [],
    inserted_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: p.status === "completed" || p.status === "failed" ? new Date().toISOString() : null,
  };
}

export type WcagCriteriaResponse = components["schemas"]["WcagCriteriaResponse"];

/**
 * Catálogo de `GET /api/wcag/criteria` (RF-RA007), reduzido aos critérios das fixtures do
 * simulado, com os textos de `shared/wcag/`: 1.1.1 e 4.1.2 citados pelo eMAG, 1.4.3, 2.4.2 e
 * 3.1.1 das regras aprovadas, e 2.5.8 (WCAG 2.2, que o eMAG 3.1 não cita). As rotas do relatório
 * pedem o catálogo; sem ele, a tela cai no "só o número" do M2.
 */
export const WCAG_CATALOG: WcagCriteriaResponse = {
  content_version: "simulado",
  sources: {
    wcag: {
      name: "WCAG 2.2, Tradução Autorizada para o português do Brasil (W3C, 27/03/2025)",
      url: "https://www.w3.org/Translations/WCAG22-pt-BR-20250327/",
      license: "W3C Document License",
    },
    emag: {
      name: "Modelo de Acessibilidade em Governo Eletrônico (eMAG) 3.1",
      url: "https://emag.governoeletronico.gov.br/",
      license: "CC BY 4.0",
    },
  },
  data: [
    {
      id: "1.1.1",
      level: "A",
      since: "2.0",
      title: "Conteúdo Não Textual",
      summary:
        "Imagens, ícones, gráficos e controles que transmitem informação têm um texto equivalente. Imagens só decorativas ficam ocultas para as tecnologias assistivas.",
      who_is_affected:
        "Pessoas cegas que usam leitor de tela ouvem o texto alternativo no lugar da imagem. Sem ele, ouvem o nome do arquivo ou nada, e perdem a informação. O texto também ajuda quem usa linha braille e quem navega com as imagens desligadas.",
      url: "https://www.w3.org/Translations/WCAG22-pt-BR/#non-text-content",
      emag: [
        { id: "3.6", title: "Fornecer alternativa em texto para as imagens do sítio" },
        { id: "3.7", title: "Utilizar mapas de imagem de forma acessível" },
        { id: "6.1", title: "Fornecer alternativa em texto para os botões de imagem de formulários" },
        { id: "6.8", title: "Fornecer estratégias de segurança específicas ao invés de CAPTCHA" },
      ],
    },
    {
      id: "1.4.3",
      level: "AA",
      since: "2.0",
      title: "Contraste (Mínimo)",
      summary: "Texto e imagens de texto têm contraste mínimo de 4,5:1 com o fundo, ou de 3:1 em texto grande.",
      who_is_affected:
        "Pessoas com baixa visão, daltonismo ou visão reduzida pela idade têm dificuldade para ler texto claro sobre fundo claro. O contraste baixo também atrapalha qualquer pessoa no sol ou numa tela ruim.",
      url: "https://www.w3.org/Translations/WCAG22-pt-BR/#contrast-minimum",
      emag: [{ id: "4.1", title: "Oferecer contraste mínimo entre plano de fundo e primeiro plano" }],
    },
    {
      id: "2.4.2",
      level: "A",
      since: "2.0",
      title: "Página com Título",
      summary: "Cada página tem um título que diz o assunto ou a finalidade dela.",
      who_is_affected:
        "O título da página é a primeira coisa que o leitor de tela anuncia e é o que aparece na aba do navegador. Sem ele, quem usa leitor de tela ou tem várias abas abertas não sabe onde está.",
      url: "https://www.w3.org/Translations/WCAG22-pt-BR/#page-titled",
      emag: [{ id: "3.3", title: "Oferecer um título descritivo e informativo à página" }],
    },
    {
      id: "2.5.8",
      level: "AA",
      since: "2.2",
      title: "Tamanho do Alvo (Mínimo)",
      summary:
        "Alvos de clique ou toque têm pelo menos 24 por 24 pixels, ou espaço suficiente em volta, salvo algumas exceções.",
      who_is_affected:
        "Pessoas com tremor, com deficiência motora ou com dedos maiores têm dificuldade para acertar alvos pequenos e acionam o vizinho por engano. Isso pesa mais no celular.",
      url: "https://www.w3.org/Translations/WCAG22-pt-BR/#target-size-minimum",
      emag: [],
    },
    {
      id: "3.1.1",
      level: "A",
      since: "2.0",
      title: "Idioma da Página",
      summary: "O código informa o idioma principal da página.",
      who_is_affected:
        "Leitores de tela usam o idioma informado para escolher a pronúncia. Sem ele, um texto em português pode ser lido com a pronúncia do inglês e ficar incompreensível.",
      url: "https://www.w3.org/Translations/WCAG22-pt-BR/#language-of-page",
      emag: [{ id: "3.1", title: "Identificar o idioma principal da página" }],
    },
    {
      id: "4.1.2",
      level: "A",
      since: "2.0",
      title: "Nome, Função, Valor",
      summary:
        "Todo controle da interface tem nome, função e estado expostos no código, e as mudanças de estado chegam às tecnologias assistivas.",
      who_is_affected:
        'Quem usa leitor de tela ou comando de voz depende do código para saber o que é cada controle e se ele está marcado, aberto ou selecionado. Um botão sem nome é anunciado só como "botão".',
      url: "https://www.w3.org/Translations/WCAG22-pt-BR/#name-role-value",
      emag: [{ id: "1.1", title: "Respeitar os Padrões Web" }],
    },
  ],
};

export const WCAG_CRITERIA_PATH = "/api/wcag/criteria";

/** Responde o catálogo dos critérios (para quem trata `/api/**` numa rota só). */
export function fulfillWcagCriteria(route: Route) {
  return route.fulfill({ json: WCAG_CATALOG });
}

/** Responde `GET /api/audits/:id` e `/pages` com o estado atual (mutável pelo teste). */
export async function mockAuditApi(page: Page, state: { revision: number; progress: Progress }) {
  await page.route(`**${WCAG_CRITERIA_PATH}`, fulfillWcagCriteria);
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
