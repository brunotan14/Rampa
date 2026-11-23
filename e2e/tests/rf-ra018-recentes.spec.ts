import { expect, test, type Page, type Request } from "@playwright/test";
import { A11Y_MEDIA, axeViolations, emulateOnly, revealAll } from "./a11y.js";
import { ZERO, progress, summary } from "./simulado.js";

// RF-RA018, auditorias recentes deste navegador, com a API e o canal simulados: a lista sai do
// `localStorage` e a tela inicial só pede o status atual de cada item (`GET /api/audits/:id`).
// A auditoria apagada de verdade no backend (CA2.4) fica no integrado. Os textos afirmados são
// os de `frontend/src/i18n/pt-BR.ts` (home.recent e auditStatus).

// O item mostra a data no fuso do navegador: fixo para o texto ser previsível.
test.use({ timezoneId: "America/Sao_Paulo" });

const RECENT_KEY = "rampa.recentAudits.v1";
const TITLE = "Auditorias recentes";
const LIST = "Auditorias recentes deste navegador";
const CLEAR = "Limpar lista";
const EMPTY = "Nenhuma auditoria ainda";
const NOTICE = "Esta lista fica só neste navegador. Nada dela vai para o servidor.";
const CLEARED = "Lista apagada.";

const ID_A = "a1a1a1a1-1111-4111-8111-111111111111";
const ID_B = "b2b2b2b2-2222-4222-8222-222222222222";
const ID_C = "c3c3c3c3-3333-4333-8333-333333333333";

type Status = "queued" | "running" | "completed" | "failed" | "cancelled";

interface FakeAudit {
  startUrl: string;
  /** `inserted_at` da API: a data que o item mostra. */
  createdAt: string;
  status: Status;
}

interface StoredItem extends FakeAudit {
  id: string;
  lastOpenedAt: string;
}

/**
 * API e canal simulados para várias auditorias. Id fora do mapa responde "não encontrada", como
 * a API real. O `POST /api/audits` cria com o próximo id de `nextIds`, na fila. O mapa é do
 * teste: mudar o status de uma auditoria muda a próxima resposta.
 */
async function mockAudits(page: Page, audits: Map<string, FakeAudit>, nextIds: string[] = []) {
  const body = (id: string, audit: FakeAudit) => ({
    ...summary(3, progress({ status: audit.status, pages_scanned: audit.status === "completed" ? 1 : 0 }), audit.startUrl),
    id,
    inserted_at: audit.createdAt,
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/audits" && request.method() === "POST") {
      const id = nextIds.shift();
      if (id === undefined) throw new Error("POST /api/audits sem id simulado na fila");
      const { url } = request.postDataJSON() as { url: string };
      const startUrl = /^https?:\/\//.test(url) ? url : `https://${url}/`;
      audits.set(id, { startUrl, createdAt: new Date().toISOString(), status: "queued" });
      return route.fulfill({ status: 202, json: { id } });
    }
    const match = /^\/api\/audits\/([0-9a-f-]{36})(\/pages|\/findings)?$/.exec(path);
    const audit = match ? audits.get(match[1]!) : undefined;
    if (!match || audit === undefined) {
      return route.fulfill({ status: 404, json: { error: { code: "audit_not_found", message: "Auditoria não encontrada." } } });
    }
    if (match[2] === "/pages") return route.fulfill({ json: { data: [] } });
    if (match[2] === "/findings") return route.fulfill({ json: { data: [], next_cursor: null, total: 0 } });
    return route.fulfill({ json: body(match[1]!, audit) });
  });
  // Canal: o join de `audit:<id>` responde com o estado atual; heartbeat e leave, "ok".
  await page.routeWebSocket(/\/socket\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event] = JSON.parse(String(raw)) as [string | null, string, string, string];
      const reply = (response: unknown, status = "ok") =>
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status, response }]));
      if (event === "heartbeat" || event === "phx_leave") return reply({});
      if (event !== "phx_join") return;
      const audit = audits.get(topic.replace(/^audit:/, ""));
      if (audit === undefined) return reply({ reason: "audit_not_found" }, "error");
      const p = progress({ status: audit.status, pages_scanned: audit.status === "completed" ? 1 : 0, totals_by_severity: ZERO });
      reply({ revision: 3, progress: p });
    });
  });
}

/** Grava a lista direto no armazenamento (estado de partida que o caso não testa) e recarrega. */
async function seedRecent(page: Page, items: StoredItem[]) {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [RECENT_KEY, JSON.stringify({ version: 1, items })] as const,
  );
  await page.reload();
}

const section = (page: Page) => page.getByRole("region", { name: TITLE });
const recentLinks = (page: Page) => section(page).getByRole("list", { name: LIST }).getByRole("link");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Nome acessível do item: endereço, data de criação e status, separados por vírgula. O link é
 * flex, e o Chromium separa com espaço os filhos em bloco ao calcular o nome ("endereço , Criada"):
 * o espaço antes da vírgula não muda o que o leitor de tela fala.
 */
const itemName = (label: string, created: string, status: string) =>
  new RegExp(`^${[label, `Criada ${created}`, status].map(escape).join(" ?, ")}$`);

const OLD: FakeAudit = { startUrl: "https://exemplo.com.br/servicos", createdAt: "2026-11-02T13:00:00.000Z", status: "completed" };
const MID: FakeAudit = { startUrl: "https://prefeitura.exemplo.org/", createdAt: "2026-11-05T17:30:00.000Z", status: "failed" };
const NEW: FakeAudit = { startUrl: "https://loja.exemplo.net/ofertas", createdAt: "2026-11-09T12:15:00.000Z", status: "running" };

/** A, B e C na lista, com C (a mais antiga das aberturas) no fim. */
function threeAudits() {
  const audits = new Map<string, FakeAudit>([
    [ID_A, NEW],
    [ID_B, MID],
    [ID_C, OLD],
  ]);
  const stored: StoredItem[] = [
    { id: ID_A, ...NEW, lastOpenedAt: "2026-11-20T10:00:00.000Z" },
    { id: ID_B, ...MID, lastOpenedAt: "2026-11-19T10:00:00.000Z" },
    { id: ID_C, ...OLD, lastOpenedAt: "2026-11-10T10:00:00.000Z" },
  ];
  return { audits, stored };
}

const NAME_A = itemName("loja.exemplo.net/ofertas", "em 09/11/2026, às 09:15", "Em andamento");
const NAME_B = itemName("prefeitura.exemplo.org", "em 05/11/2026, às 14:30", "Interrompida");
const NAME_C = itemName("exemplo.com.br/servicos", "em 02/11/2026, às 10:00", "Concluída");

test.describe("RF-RA018: auditorias recentes na tela inicial", () => {
  test("CA1.1: duas auditorias criadas aparecem da mais recente para a mais antiga, com o status atual", async ({ page }) => {
    const audits = new Map<string, FakeAudit>();
    await mockAudits(page, audits, [ID_A, ID_B]);

    for (const url of ["primeiro.exemplo.com.br", "segundo.exemplo.com.br"]) {
      await page.goto("/");
      await page.getByRole("textbox", { name: "Endereço do site" }).fill(url);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1, name: `Auditando ${url}` })).toBeVisible();
    }
    // Entre a criação e a volta, a primeira terminou: o item mostra o status novo.
    audits.get(ID_A)!.status = "completed";

    await page.getByRole("link", { name: "Rampa, página inicial" }).click();
    await expect(recentLinks(page)).toHaveCount(2);
    await expect(recentLinks(page).nth(0)).toHaveAccessibleName(/^segundo\.exemplo\.com\.br ?, Criada às \d{2}:\d{2} ?, Na fila$/);
    await expect(recentLinks(page).nth(1)).toHaveAccessibleName(/^primeiro\.exemplo\.com\.br ?, Criada às \d{2}:\d{2} ?, Concluída$/);
    await expect(recentLinks(page).nth(0)).toHaveAttribute("href", `/auditorias/${ID_B}`);
    await expect(recentLinks(page).nth(1)).toHaveAttribute("href", `/auditorias/${ID_A}`);
  });

  test("CA1.2: a auditoria aberta por um link recebido aparece na lista", async ({ page }) => {
    await mockAudits(page, new Map([[ID_C, OLD]]));
    await page.goto("/");
    await expect(section(page).getByRole("heading", { level: 3, name: EMPTY })).toBeVisible();

    await page.goto(`/auditorias/${ID_C}`);
    await expect(page.getByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" })).toBeVisible();
    await page.getByRole("link", { name: "Rampa, página inicial" }).click();

    await expect(recentLinks(page)).toHaveCount(1);
    await expect(recentLinks(page).first()).toHaveAccessibleName(NAME_C);
    await expect(recentLinks(page).first()).toHaveAttribute("href", `/auditorias/${ID_C}`);
  });

  test("CA1.6: reabrir a auditoria do fim da lista a leva ao topo, ainda com a data de criação", async ({ page }) => {
    const { audits, stored } = threeAudits();
    await mockAudits(page, audits);
    await seedRecent(page, stored);
    await expect(recentLinks(page)).toHaveCount(3);
    await expect(recentLinks(page).nth(2)).toHaveAccessibleName(NAME_C);

    await recentLinks(page).nth(2).click();
    await expect(page.getByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" })).toBeVisible();
    await page.getByRole("link", { name: "Rampa, página inicial" }).click();

    await expect(recentLinks(page)).toHaveCount(3);
    await expect(recentLinks(page).nth(0)).toHaveAccessibleName(NAME_C);
    await expect(recentLinks(page).nth(0).locator("time")).toHaveAttribute("datetime", OLD.createdAt);
    await expect(recentLinks(page).nth(1)).toHaveAccessibleName(NAME_A);
    await expect(recentLinks(page).nth(2)).toHaveAccessibleName(NAME_B);
  });

  test("CA1.5: pelo teclado, cada item é um link que lê endereço, data e status, com ícone, e o axe não aponta nada", async ({ page }) => {
    const { audits, stored } = threeAudits();
    await mockAudits(page, audits);
    await seedRecent(page, stored);
    await expect(recentLinks(page)).toHaveCount(3);

    // Do botão Auditar até "Limpar lista", só pelo Tab: os três itens, na ordem da lista.
    await page.getByRole("button", { name: "Auditar" }).focus();
    const reached: string[] = [];
    for (let i = 0; i < 30 && !reached.includes(CLEAR); i += 1) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.closest("[data-audit-id]") ? (el.getAttribute("href") ?? "") : (el?.textContent ?? "").trim();
      });
      reached.push(name);
    }
    const order = reached.filter((name) => name.startsWith("/auditorias/") || name === CLEAR);
    expect(order).toEqual([`/auditorias/${ID_A}`, `/auditorias/${ID_B}`, `/auditorias/${ID_C}`, CLEAR]);

    for (const [index, name, status] of [
      [0, NAME_A, "Em andamento"],
      [1, NAME_B, "Interrompida"],
      [2, NAME_C, "Concluída"],
    ] as const) {
      const link = recentLinks(page).nth(index);
      await expect(link).toHaveAccessibleName(name);
      // Status em texto, com ícone ao lado (decorativo: o texto já diz o status).
      const icon = link.getByText(status, { exact: true }).locator("svg");
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    }

    await revealAll(page);
    expect(await axeViolations(page)).toEqual([]);

    await recentLinks(page).first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/auditorias/${ID_A}`);
  });

  test("CA3.1: depois de \"Limpar lista\", recarregar mostra o estado vazio", async ({ page }) => {
    const { audits, stored } = threeAudits();
    await mockAudits(page, audits);
    await seedRecent(page, stored);
    await expect(recentLinks(page)).toHaveCount(3);
    await expect(section(page)).toContainText(NOTICE);

    await section(page).getByRole("button", { name: CLEAR }).click();
    await expect(section(page).getByRole("heading", { level: 2, name: TITLE })).toBeFocused();
    await expect(section(page).getByRole("status")).toHaveText(CLEARED);

    await page.reload();
    await expect(section(page).getByRole("heading", { level: 3, name: EMPTY })).toBeVisible();
    await expect(section(page).getByRole("list", { name: LIST })).toHaveCount(0);
    await expect(section(page).getByRole("button", { name: CLEAR })).toHaveCount(0);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), RECENT_KEY)).toBeNull();
  });

  test("SC-004: nenhuma requisição leva a chave nem o conteúdo da lista de recentes", async ({ page }) => {
    // Endereços com marcador próprio: só existem na lista guardada, nunca são digitados.
    const marked = new Map<string, FakeAudit>([
      [ID_A, { ...NEW, startUrl: "https://marcador-recentes-a.exemplo.com.br/" }],
      [ID_B, { ...MID, startUrl: "https://marcador-recentes-b.exemplo.com.br/" }],
    ]);
    const stored: StoredItem[] = [...marked].map(([id, audit], index) => ({ id, ...audit, lastOpenedAt: `2026-11-2${index}T10:00:00.000Z` }));
    await mockAudits(page, marked, [ID_C]);
    const requests: Request[] = [];
    page.on("request", (request) => requests.push(request));
    const frames: string[] = [];
    page.on("websocket", (ws) => ws.on("framesent", (frame) => frames.push(String(frame.payload))));

    await seedRecent(page, stored);
    await expect(recentLinks(page)).toHaveCount(2);
    // Com a lista guardada, criar outra auditoria e voltar: a lista não vai junto em nenhum passo.
    await page.getByRole("textbox", { name: "Endereço do site" }).fill("terceiro.exemplo.com.br");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Auditando terceiro.exemplo.com.br" })).toBeVisible();
    await page.getByRole("link", { name: "Rampa, página inicial" }).click();
    await expect(recentLinks(page)).toHaveCount(3);

    const sent = await Promise.all(
      requests.map(async (request) => [request.url(), JSON.stringify(await request.allHeaders()), request.postData() ?? ""].join("\n")),
    );
    expect(requests.some((request) => request.url().includes(`/api/audits/${ID_A}`))).toBe(true);
    const leaks = [...sent, ...frames].filter((text) => /rampa\.recentAudits|marcador-recentes|lastOpenedAt/.test(text));
    expect(leaks).toEqual([]);
  });
});

test.describe("RF-RA018: navegador sem armazenamento local", () => {
  // Como num navegador que bloqueia o armazenamento do site: o próprio acesso lança SecurityError.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("O acesso ao armazenamento foi negado.", "SecurityError");
        },
      });
    });
  });

  test("CA4.1: a tela inicial funciona e a seção mostra o estado vazio", async ({ page }) => {
    await mockAudits(page, new Map([[ID_C, OLD]]));
    await page.goto("/");
    const blocked = await page.evaluate(() => {
      try {
        return window.localStorage === undefined;
      } catch (error) {
        return error instanceof DOMException && error.name === "SecurityError";
      }
    });
    expect(blocked, "o acesso ao localStorage lança SecurityError").toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(section(page).getByRole("heading", { level: 3, name: EMPTY })).toBeVisible();
    await expect(section(page)).toContainText(NOTICE);
    await expect(page.getByRole("textbox", { name: "Endereço do site" })).toBeEditable();
    await expect(page.getByRole("button", { name: "Auditar" })).toBeEnabled();
  });

  test("SC-005: sem armazenamento, a tela inicial cria a auditoria e volta sem erro no console", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await mockAudits(page, new Map(), [ID_A]);

    await page.goto("/");
    await page.getByRole("textbox", { name: "Endereço do site" }).fill("exemplo.com.br");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Auditando exemplo.com.br" })).toBeVisible();
    await page.getByRole("link", { name: "Rampa, página inicial" }).click();
    await expect(section(page).getByRole("heading", { level: 3, name: EMPTY })).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe("RF-RA018 SC-002: axe na seção de recentes", () => {
  const STATES = ["vazia", "com itens", "depois de limpar"] as const;
  for (const state of STATES) {
    for (const media of A11Y_MEDIA) {
      test(`SC-002: lista ${state}, sem violações do axe (${JSON.stringify(media)})`, async ({ page }) => {
        const { audits, stored } = threeAudits();
        await mockAudits(page, audits);
        await emulateOnly(page, media);
        if (state === "vazia") {
          await page.goto("/");
        } else {
          await seedRecent(page, stored);
          await expect(recentLinks(page)).toHaveCount(3);
        }
        if (state === "depois de limpar") {
          await section(page).getByRole("button", { name: CLEAR }).click();
          await expect(section(page).getByRole("status")).toHaveText(CLEARED);
        }
        if (state !== "com itens") await expect(section(page).getByRole("heading", { level: 3, name: EMPTY })).toBeVisible();
        await revealAll(page);
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  }
});
