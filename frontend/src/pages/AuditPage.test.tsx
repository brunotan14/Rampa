import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FakeSocket } from "../../test/fakeSocket";
import { AUDIT_ID, PAGE_ID, auditSummary, progress } from "../../test/fixtures";
import { axeViolations, jsonResponse, renderRoute } from "../../test/render";
import { BATCH_MS } from "../api/channel";
import type { AuditSummary, ChannelProgress, PageSummary } from "../api/types";

const fetchMock = vi.fn<typeof fetch>();
const PATH = `/auditorias/${AUDIT_ID}`;
const SUMMARY_URL = `/api/audits/${AUDIT_ID}`;
const PAGES_URL = `/api/audits/${AUDIT_ID}/pages`;

let summary: AuditSummary;
let pages: PageSummary[];

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-12T14:00:00Z") });
  summary = auditSummary({ status: "running", pages_found: 5, revision: 1 });
  pages = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === SUMMARY_URL) return jsonResponse(summary);
    if (url === PAGES_URL) return jsonResponse({ data: pages });
    throw new Error(`sem resposta para ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const summaryGets = () => fetchMock.mock.calls.filter(([url]) => String(url) === SUMMARY_URL).length;

async function open(path = PATH) {
  const socket = new FakeSocket();
  const view = renderRoute(path, { socket });
  await advance(0);
  return { ...view, socket, channel: () => socket.last };
}

const zero = { critical: 0, serious: 0, moderate: 0, minor: 0 };

function at(revision: number, overrides: Partial<ChannelProgress>) {
  return { revision, progress: progress({ pages_found: 5, ...overrides }) };
}

function stat(term: string) {
  const dt = screen.getAllByRole("term").find((el) => el.textContent === term);
  if (!dt) throw new Error(`sem o termo ${term}`);
  return dt.nextElementSibling as HTMLElement;
}

const live = () => screen.getByRole("status");

/** Todos os textos que a região viva teve, na ordem (cada troca de conteúdo). */
function recordLive() {
  const said: string[] = [];
  const region = live();
  const observer = new MutationObserver(() => {
    const text = region.textContent ?? "";
    if (text !== "") said.push(text);
  });
  observer.observe(region, { childList: true, characterData: true, subtree: true });
  return said;
}

describe("AuditPage: tela de progresso (RF-RA004)", () => {
  it("auditoria em andamento: h1 com o host, etapa atual, progresso, feed e achados; uma única região viva", async () => {
    vi.useRealTimers();
    const socket = new FakeSocket();
    const { container } = renderRoute(PATH, { socket });
    expect(await screen.findByRole("heading", { level: 1, name: "Auditando exemplo.com.br" })).toBeInTheDocument();
    act(() => socket.last.reply(at(1, { pages_scanned: 1, totals_by_severity: { ...zero, critical: 2 } })));
    expect(document.title).toBe("Auditando exemplo.com.br – Rampa");
    const steps = screen.getByRole("list", { name: "Etapas da auditoria" });
    expect(within(steps).getByText(/Varredura automática/).closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("progressbar", { name: "Analisando o site…" })).toHaveAttribute("aria-valuenow", "20");
    expect(stat("Analisadas")).toHaveTextContent("1");
    expect(stat("Críticos")).toHaveTextContent("2");
    expect(screen.getByRole("heading", { level: 2, name: "Problemas encontrados até agora" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Atividade" })).toBeInTheDocument();
    expect(screen.getByText("Ao vivo")).toBeInTheDocument();
    expect(container.querySelectorAll("[aria-live], [role=status], [role=alert], [role=log]")).toHaveLength(1);
    expect(live()).toBeEmptyDOMElement();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("CA1: cada página terminada aumenta o contador de analisadas sem recarregar e sem anunciar cada página", async () => {
    const { channel, router } = await open();
    act(() => channel().reply(at(1, {})));
    const said = recordLive();
    const gets = summaryGets();

    for (let n = 1; n <= 4; n++) {
      act(() =>
        channel().push("page_scanned", {
          ...at(1 + n, { pages_scanned: n }),
          page_id: `${PAGE_ID.slice(0, -1)}${n}`,
          counts_by_severity: zero,
          needs_review_count: 0,
        }),
      );
      await advance(BATCH_MS);
      expect(stat("Analisadas")).toHaveTextContent(String(n));
    }

    expect(router.state.location.pathname).toBe(PATH);
    expect(summaryGets()).toBe(gets);
    // 4 páginas em 2 s: no máximo o primeiro marco (40%), nunca uma frase por página.
    expect(said).toEqual(["40% concluído. 2 de 5 páginas analisadas."]);
  });

  it("CA2: ao terminar, a região viva diz 'Auditoria concluída: N problemas em M páginas' uma única vez", async () => {
    const { channel } = await open();
    act(() => channel().reply(at(1, { pages_scanned: 4 })));
    const said = recordLive();
    const done = at(2, { status: "completed", pages_scanned: 5, totals_by_severity: { ...zero, critical: 2, minor: 1 } });

    act(() => channel().push("audit_completed", { ...done, score: null }));
    await advance(BATCH_MS);
    // O mesmo fim chega de novo: evento repetido e o snapshot de uma reconexão.
    act(() => channel().push("audit_completed", { ...done, score: null }));
    act(() => channel().drop());
    act(() => channel().reply(done));
    await advance(BATCH_MS * 4);

    expect(said).toEqual(["Auditoria concluída: 3 problemas em 5 páginas."]);
    expect(screen.getByRole("heading", { level: 1, name: "Auditoria de exemplo.com.br concluída" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Varredura concluída" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver relatório" })).toBeInTheDocument();
    expect(screen.queryByText("Ao vivo")).not.toBeInTheDocument();
  });

  it("CA2: se o GET dizia 'em andamento' e o primeiro snapshot do canal já vem concluído, a conclusão também é anunciada", async () => {
    const { channel } = await open();
    const said = recordLive();
    act(() => channel().reply(at(3, { status: "completed", pages_scanned: 5 })));
    await advance(BATCH_MS);
    expect(said).toEqual(["Auditoria concluída: 0 problemas em 5 páginas."]);
  });

  it("CA3: a conexão cai (aviso visível) e, ao voltar, os contadores mostram o estado real", async () => {
    const { channel } = await open();
    act(() => channel().reply(at(1, { pages_scanned: 1 })));
    const said = recordLive();

    act(() => channel().drop());
    await advance(0);
    expect(screen.getByText("Sem conexão. Tentando reconectar; os números podem estar atrasados.")).toBeInTheDocument();
    await advance(10_000);

    // Eventos perdidos na queda: o snapshot do novo join traz o estado atual.
    act(() => channel().reply(at(7, { pages_scanned: 3, pages_failed: 1, totals_by_severity: { ...zero, serious: 4 } })));
    await advance(BATCH_MS);
    expect(screen.queryByText(/Sem conexão/)).not.toBeInTheDocument();
    expect(screen.getByText("Ao vivo")).toBeInTheDocument();
    expect(stat("Analisadas")).toHaveTextContent("3");
    expect(stat("Com falha")).toHaveTextContent("1");
    expect(stat("Sérios")).toHaveTextContent("4");
    // A queda e a volta não falam; o salto de 20% para 80% é um marco só.
    expect(said).toEqual(["80% concluído. 3 de 5 páginas analisadas."]);
  });

  it("falha: o motivo aparece na tela, a parada é anunciada uma vez e há caminho para uma nova auditoria", async () => {
    const { channel } = await open();
    act(() => channel().reply(at(1, {})));
    const said = recordLive();
    const reason = "A página demorou demais para carregar ou para ser analisada.";
    act(() =>
      channel().push("audit_failed", at(2, { status: "failed", pages_failed: 1, pages_found: 1, error: { code: "timeout", message: reason } })),
    );
    await advance(BATCH_MS);
    expect(said).toEqual([`A auditoria parou. ${reason}`]);
    expect(screen.getByRole("heading", { level: 1, name: "A auditoria de exemplo.com.br parou" })).toBeInTheDocument();
    expect(screen.getByText(reason, { exact: false, selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/interrompida/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fazer uma nova auditoria" })).toHaveAttribute("href", "/");
  });

  it("'Ver relatório' leva ao relatório (ainda em construção) com o foco no h1", async () => {
    const { channel } = await open();
    act(() => channel().reply(at(1, { pages_scanned: 4 })));
    act(() => channel().push("audit_completed", { ...at(2, { status: "completed", pages_scanned: 5 }), score: null }));
    await advance(BATCH_MS);
    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: "Ver relatório" }));
    const h1 = screen.getByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" });
    expect(h1).toHaveFocus();
    expect(document.title).toBe("Relatório de exemplo.com.br – Rampa");
    expect(screen.getByRole("link", { name: "Fazer uma nova auditoria" })).toHaveAttribute("href", "/");
  });

  it("auditoria já concluída ao abrir: mostra o relatório em construção, sem anunciar nada", async () => {
    summary = auditSummary({ status: "completed", pages_found: 1, pages_scanned: 1, totals_by_severity: { ...zero, critical: 1 } });
    const { channel, container } = await open();
    act(() => channel().reply(at(1, { status: "completed", pages_found: 1, pages_scanned: 1, totals_by_severity: { ...zero, critical: 1 } })));
    await advance(BATCH_MS);
    expect(screen.getByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" })).toBeInTheDocument();
    expect(screen.getByText("A auditoria terminou: 1 problema em 1 página.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fazer uma nova auditoria" })).toBeInTheDocument();
    expect(container.querySelector("[aria-live]")).toBeNull();
    vi.useRealTimers();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("auditoria que já tinha falhado ao abrir: mostra o erro", async () => {
    summary = auditSummary({ status: "failed", pages_failed: 1, error: { code: "blocked_address", message: "Este endereço não pode ser auditado." } });
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "A auditoria de exemplo.com.br parou" })).toBeInTheDocument();
    expect(screen.getByText("Este endereço não pode ser auditado.", { exact: false, selector: "p" })).toBeInTheDocument();
  });

  it("na fila: etapa 'Na fila' e título da varredura", async () => {
    summary = auditSummary({ status: "queued" });
    await open();
    expect(screen.getByRole("heading", { level: 2, name: "Na fila para começar" })).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Etapas da auditoria" })).getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("1Na fila, em andamento");
    expect(steps[0]).toHaveAttribute("aria-current", "step");
  });

  it("feed: a página terminada aparece com o caminho e a hora, buscados na lista de páginas", async () => {
    const { channel } = await open();
    act(() => channel().reply(at(1, {})));
    pages = [
      {
        id: PAGE_ID,
        url: "https://exemplo.com.br/contato",
        final_url: null,
        title: null,
        status: "done",
        http_status: 200,
        error: null,
        scanned_at: "2026-11-12T14:00:05Z",
        counts_by_severity: { ...zero, serious: 2 },
        needs_review_count: 0,
        passed_count: null,
      },
    ];
    act(() =>
      channel().push("page_scanned", {
        ...at(2, { pages_scanned: 1 }),
        page_id: PAGE_ID,
        counts_by_severity: { ...zero, serious: 2 },
        needs_review_count: 0,
      }),
    );
    await advance(BATCH_MS);
    await advance(0);
    const feed = screen.getByRole("region", { name: "Atividade" });
    expect(within(feed).getByRole("listitem")).toHaveTextContent("/contato analisada: 2 problemas");
    expect(within(feed).getByRole("listitem").querySelector("time")).toHaveAttribute("datetime", "2026-11-12T14:00:05.000Z");
  });

  it("404: auditoria inexistente mostra o erro em alerta, com caminho de volta", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: { code: "audit_not_found", message: "Auditoria não encontrada. Confira o endereço do relatório." } }, { status: 404 }),
    );
    const { channel } = await open();
    act(() => channel().refuse({ error: { code: "audit_not_found", message: "Auditoria não encontrada. Confira o endereço do relatório." } }));
    await advance(0);
    expect(screen.getByRole("heading", { level: 1, name: "Auditoria não encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Erro: Não encontramos esta auditoria");
    expect(screen.getByRole("link", { name: "Fazer uma nova auditoria" })).toHaveAttribute("href", "/");
  });

  it("carregando: h1 desde o primeiro quadro e aviso de carregamento; resposta lenta avisa depois de 10 s", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "Carregando auditoria" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando a auditoria…");
    await advance(10_000);
    expect(screen.getByRole("status")).toHaveTextContent(/Está demorando mais do que o normal/);
  });

  it("sem rede e sem canal: erro com a mensagem do cliente e botão para tentar de novo", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await open();
    await advance(0);
    expect(screen.getByRole("heading", { level: 1, name: "Não conseguimos carregar a auditoria" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Não conseguimos falar com o Rampa.");
    fetchMock.mockImplementation(async (input) => jsonResponse(String(input) === SUMMARY_URL ? summary : { data: [] }));
    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Auditando exemplo.com.br" })).toBeInTheDocument();
  });

  it("canal recusado por limite de canais: mostra a mensagem", async () => {
    const { channel } = await open();
    act(() => channel().refuse({ error: { code: "channel_limit_reached", message: "Esta conexão já acompanha auditorias demais." } }));
    await advance(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Esta conexão já acompanha auditorias demais.");
  });
});
