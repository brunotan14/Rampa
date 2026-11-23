import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { auditSummary } from "../../test/fixtures";
import { axeViolations, jsonResponse, renderRoute, testQueryClient } from "../../test/render";
import { queryKeys } from "../api/queryKeys";
import type { AuditSummary } from "../api/types";
import { RECENT_KEY, readRecent, type RecentAudit } from "../recentAudits";

const ID_A = "3f2b8c1e-7a4d-4e5f-9b0c-1d2e3f4a5b6c";
const ID_B = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID_C = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";

const fetchMock = vi.fn<typeof fetch>();

function recent(id: string, overrides: Partial<RecentAudit> = {}): RecentAudit {
  return {
    id,
    startUrl: `https://${id.slice(0, 4)}.exemplo.com.br/contato`,
    createdAt: "2026-11-12T10:00:00Z",
    status: "completed",
    lastOpenedAt: "2026-11-20T12:00:00.000Z",
    ...overrides,
  };
}

function seed(...items: RecentAudit[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify({ version: 1, items }));
}

const notFound = () =>
  jsonResponse({ error: { code: "audit_not_found", message: "Auditoria não encontrada." } }, { status: 404 });

/** Respostas do `GET /api/audits/:id` por id; o que não estiver aqui fica pendente. */
function respond(byId: Record<string, () => Response | Promise<Response>>) {
  fetchMock.mockImplementation(async (input) => {
    const id = String(input).split("/").at(-1)!;
    const answer = byId[id];
    return answer ? answer() : new Promise<Response>(() => undefined);
  });
}

const summaryOf = (id: string, overrides: Partial<AuditSummary> = {}) => () =>
  jsonResponse(auditSummary({ id, status: "completed", ...overrides }));

function deferred() {
  let release: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => (release = resolve));
  return { promise, release };
}

const section = () => screen.getByRole("region", { name: "Auditorias recentes" });
const heading = () => screen.getByRole("heading", { level: 2, name: "Auditorias recentes" });
const links = () => within(section()).queryAllByRole("link");
/** A região viva da seção (o `StateMessage` carregando também é `status`, sem aria-live). */
const live = () => section().querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RecentAudits (RF-RA018)", () => {
  it("CA1.1: mostra as auditorias da mais recente para a mais antiga, e respostas com atrasos diferentes não mudam a ordem", async () => {
    seed(recent(ID_A, { lastOpenedAt: "2026-11-20T10:00:00.000Z" }), recent(ID_B, { lastOpenedAt: "2026-11-20T11:00:00.000Z" }));
    const slowB = deferred();
    respond({ [ID_A]: summaryOf(ID_A, { status: "running" }), [ID_B]: () => slowB.promise });
    renderRoute("/");
    expect(links().map((a) => a.getAttribute("href"))).toEqual([`/auditorias/${ID_B}`, `/auditorias/${ID_A}`]);
    // A resposta de A (a mais antiga) chega primeiro.
    await waitFor(() => expect(links()[1]).toHaveTextContent("Em andamento"));
    expect(links().map((a) => a.getAttribute("href"))).toEqual([`/auditorias/${ID_B}`, `/auditorias/${ID_A}`]);
    await act(async () => slowB.release(summaryOf(ID_B, { status: "failed" })()));
    await waitFor(() => expect(links()[0]).toHaveTextContent("Interrompida"));
    expect(links().map((a) => a.getAttribute("href"))).toEqual([`/auditorias/${ID_B}`, `/auditorias/${ID_A}`]);
    expect(readRecent().map((r) => r.id)).toEqual([ID_B, ID_A]);
  });

  it("CA1.3: o item mostra o status atual da API, grava o status novo e não mexe em lastOpenedAt nem na ordem", async () => {
    seed(recent(ID_A, { status: "running", lastOpenedAt: "2026-11-20T10:00:00.000Z" }), recent(ID_B));
    respond({ [ID_A]: summaryOf(ID_A, { status: "completed" }), [ID_B]: summaryOf(ID_B) });
    renderRoute("/");
    expect(links()[1]).toHaveTextContent("Em andamento");
    await waitFor(() => expect(links()[1]).toHaveTextContent("Concluída"));
    await waitFor(() => expect(readRecent()[1]).toEqual(recent(ID_A, { status: "completed", lastOpenedAt: "2026-11-20T10:00:00.000Z" })));
    expect(readRecent()[0]).toEqual(recent(ID_B));
  });

  it("CA1.5: cada item é um link para o relatório que lê o endereço, a data e o status em texto, com ícone", async () => {
    seed(recent(ID_A, { startUrl: "https://exemplo.com.br/serviços" }));
    respond({ [ID_A]: summaryOf(ID_A) });
    renderRoute("/");
    const link = await within(section()).findByRole("link", {
      name: /^exemplo\.com\.br\/serviços, Criada em 12\/11\/2026, às \d{2}:\d{2}, Concluída$/,
    });
    expect(link).toHaveAttribute("href", `/auditorias/${ID_A}`);
    expect(within(link).getByText(/Criada em/).closest("time")).toHaveAttribute("datetime", "2026-11-12T10:00:00Z");
    expect(within(link).getByText("Concluída").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" })).toBeInTheDocument();
    cleanup();
    seed(recent(ID_A));
    const again = renderRoute("/");
    await within(section()).findByRole("link");
    expect(await axeViolations(again.container)).toEqual([]);
  });

  it("CA1.5: o endereço exibido não tem caracteres bidi e o href vem do id, nunca do endereço", async () => {
    seed(recent(ID_A, { startUrl: "https://exemplo.com.br/fatura‮fdp.exe" }));
    respond({ [ID_A]: summaryOf(ID_A) });
    renderRoute("/");
    const [link] = links();
    expect(link).toHaveAttribute("href", `/auditorias/${ID_A}`);
    expect(link!.textContent).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(link).toHaveTextContent("exemplo.com.br/faturafdp.exe");
  });

  it("CA2.4: auditoria que responde 'não encontrada' sai da lista e do armazenamento", async () => {
    seed(recent(ID_A, { lastOpenedAt: "2026-11-20T10:00:00.000Z" }), recent(ID_B));
    respond({ [ID_A]: notFound, [ID_B]: summaryOf(ID_B) });
    renderRoute("/");
    expect(links()).toHaveLength(2);
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(links()[0]).toHaveAttribute("href", `/auditorias/${ID_B}`);
    expect(readRecent().map((r) => r.id)).toEqual([ID_B]);
  });

  it("CA1.3: status vindo de uma busca feita por outra tela (cache) também é guardado", async () => {
    seed(recent(ID_A, { status: "running" }));
    // Nenhuma busca desta tela responde: o status novo chega só pelo cache compartilhado, como
    // quando a busca em andamento é a do relatório.
    respond({});
    const client = testQueryClient();
    client.setQueryData(queryKeys.audit(ID_A), auditSummary({ id: ID_A, status: "completed" }));
    renderRoute("/", { client });
    await waitFor(() => expect(readRecent()[0]?.status).toBe("completed"));
  });

  it("CA2.4: se o item com foco sai da lista, o foco vai para o título da seção", async () => {
    seed(recent(ID_A, { lastOpenedAt: "2026-11-20T10:00:00.000Z" }), recent(ID_B));
    const goneA = deferred();
    respond({ [ID_A]: () => goneA.promise, [ID_B]: summaryOf(ID_B) });
    renderRoute("/");
    const target = links()[1]!;
    act(() => target.focus());
    expect(target).toHaveFocus();
    await act(async () => goneA.release(notFound()));
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(heading()).toHaveFocus();
  });

  it("CA2.4: item sem foco que sai da lista não move o foco", async () => {
    seed(recent(ID_A, { lastOpenedAt: "2026-11-20T10:00:00.000Z" }), recent(ID_B));
    const goneA = deferred();
    respond({ [ID_A]: () => goneA.promise, [ID_B]: summaryOf(ID_B) });
    renderRoute("/");
    // Passou pelo item e seguiu para outro elemento.
    act(() => links()[1]!.focus());
    act(() => links()[0]!.focus());
    await act(async () => goneA.release(notFound()));
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(links()[0]).toHaveFocus();
  });

  it("CA2.4: a última auditoria que sai deixa o estado vazio", async () => {
    seed(recent(ID_A));
    respond({ [ID_A]: notFound });
    renderRoute("/");
    expect(await within(section()).findByRole("heading", { level: 3, name: "Nenhuma auditoria ainda" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Limpar lista" })).not.toBeInTheDocument();
  });

  it("API fora do ar: o item fica com o status guardado e avisa que não foi possível atualizar; não sai da lista", async () => {
    seed(recent(ID_A, { status: "running" }));
    respond({ [ID_A]: () => jsonResponse({ error: { code: "internal_error", message: "Erro." } }, { status: 500 }) });
    renderRoute("/");
    await waitFor(() => expect(links()[0]).toHaveTextContent("Não foi possível atualizar o status agora."));
    expect(links()[0]).toHaveTextContent("Em andamento");
    expect(links()[0]).toHaveAccessibleName(/, Em andamento, Não foi possível atualizar o status agora\.$/);
    expect(readRecent()).toHaveLength(1);
  });

  it("CA3.1: 'Limpar lista' apaga a lista; ao recarregar, a seção mostra o estado vazio", async () => {
    seed(recent(ID_A), recent(ID_B, { lastOpenedAt: "2026-11-20T11:00:00.000Z" }));
    respond({ [ID_A]: summaryOf(ID_A), [ID_B]: summaryOf(ID_B) });
    renderRoute("/");
    await userEvent.click(screen.getByRole("button", { name: "Limpar lista" }));
    expect(links()).toHaveLength(0);
    expect(within(section()).getByRole("heading", { level: 3, name: "Nenhuma auditoria ainda" })).toBeInTheDocument();
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
    cleanup();
    const reloaded = renderRoute("/");
    expect(within(section()).getByRole("heading", { level: 3, name: "Nenhuma auditoria ainda" })).toBeInTheDocument();
    expect(links()).toHaveLength(0);
    expect(await axeViolations(reloaded.container)).toEqual([]);
  });

  it("CA3.2: depois de 'Limpar lista', o foco vai para o título da seção e o leitor de tela ouve 'Lista apagada.'", async () => {
    seed(recent(ID_A));
    respond({ [ID_A]: summaryOf(ID_A) });
    renderRoute("/");
    expect(live()).toBeEmptyDOMElement();
    const button = screen.getByRole("button", { name: "Limpar lista" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(heading()).toHaveFocus();
    expect(live()).toHaveTextContent("Lista apagada.");
  });

  it("CA3.3: a seção avisa que a lista fica só neste navegador, com ou sem itens", async () => {
    renderRoute("/");
    expect(section()).toHaveTextContent("Esta lista fica só neste navegador. Nada dela vai para o servidor.");
    cleanup();
    seed(recent(ID_A));
    respond({ [ID_A]: summaryOf(ID_A) });
    renderRoute("/");
    expect(section()).toHaveTextContent("Esta lista fica só neste navegador. Nada dela vai para o servidor.");
  });

  it("CA4.1: sem armazenamento local, a seção mostra o estado vazio e nada é pedido à API", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    const { container } = renderRoute("/");
    expect(within(section()).getByRole("heading", { level: 3, name: "Nenhuma auditoria ainda" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Seu site, para todo mundo");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("CA4.3: dados corrompidos mostram o estado vazio; com itens válidos e inválidos, só os válidos", async () => {
    localStorage.setItem(RECENT_KEY, "{corrompido");
    renderRoute("/");
    expect(within(section()).getByRole("heading", { level: 3, name: "Nenhuma auditoria ainda" })).toBeInTheDocument();
    cleanup();
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify({ version: 1, items: [recent(ID_A), { ...recent(ID_B), id: "javascript:alert(1)" }, { ...recent(ID_C), startUrl: "javascript:x" }] }),
    );
    respond({ [ID_A]: summaryOf(ID_A) });
    renderRoute("/");
    expect(links().map((a) => a.getAttribute("href"))).toEqual([`/auditorias/${ID_A}`]);
  });

  it("a tela inicial nunca grava abertura e nenhum pedido leva o conteúdo da lista", async () => {
    seed(recent(ID_A), recent(ID_B, { lastOpenedAt: "2026-11-20T11:00:00.000Z" }));
    respond({ [ID_A]: summaryOf(ID_A), [ID_B]: summaryOf(ID_B) });
    const before = localStorage.getItem(RECENT_KEY);
    renderRoute("/");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(links()[0]).toHaveTextContent("Concluída"));
    expect(localStorage.getItem(RECENT_KEY)).toBe(before);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(String(input)).toMatch(/^\/api\/audits\/[0-9a-f-]{36}$/);
      expect(init?.body ?? null).toBeNull();
      expect(String(input)).not.toContain("contato");
    }
  });
});
