import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FakeSocket } from "../../test/fakeSocket";
import { AUDIT_ID, auditSummary } from "../../test/fixtures";
import { axeViolations, jsonResponse, renderRoute } from "../../test/render";
import { ApiError } from "../api/client";
import { formatFrom } from "../i18n";
import { createAuditError } from "../startAudit";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

function apiRefusal(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: { code, message, ...extra } }, { status });
}

async function submit(url: string) {
  await userEvent.type(screen.getByRole("textbox", { name: "Endereço do site" }), `${url}{Enter}`);
}

describe("HomePage", () => {
  it("tem um único h1, igual ao título do documento, e o aviso de que não garante conformidade", async () => {
    const { container } = renderRoute("/");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Seu site, para todo mundo");
    expect(document.title).toBe("Seu site, para todo mundo – Rampa");
    expect(screen.getByText(/não garante conformidade/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Como funciona" })).toBeInTheDocument();
    // Exemplo de relatório (TelaInicial), marcado como fictício e com o rótulo da pontuação.
    const example = screen.getByRole("region", { name: "Um relatório que todo mundo entende" });
    expect(example).toHaveTextContent("Exemplo com dados fictícios.");
    expect(example).toHaveTextContent("Indicador de problemas encontrados automaticamente");
    expect(example).toHaveTextContent("72 de 100");
    expect(screen.getByRole("heading", { level: 3, name: "47 problemas em 56 páginas" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("o foco não vai sozinho para o campo, e o campo é o primeiro controle depois do cabeçalho", async () => {
    renderRoute("/");
    expect(screen.getByRole("textbox")).not.toHaveFocus();
    for (let i = 0; i < 4; i++) await userEvent.tab(); // pular, logo, navegação, campo
    expect(screen.getByRole("textbox", { name: "Endereço do site" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Auditar" })).toHaveFocus();
  });

  it("não expõe o limite de páginas no M2: envia só a URL", async () => {
    fetchMock.mockImplementation(async (_input, init) =>
      init?.method === "POST" ? jsonResponse({ id: AUDIT_ID }, { status: 202 }) : jsonResponse(auditSummary()),
    );
    renderRoute("/", { socket: new FakeSocket() });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    await submit("exemplo.com.br");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0]![1]!.body))).toEqual({ url: "exemplo.com.br" });
  });

  it("RF-RA001 CA1: com URL válida, recebe o id e vai para a tela de progresso, com o foco no h1", async () => {
    fetchMock.mockImplementation(async (_input, init) =>
      init?.method === "POST"
        ? jsonResponse({ id: AUDIT_ID }, { status: 202 })
        : jsonResponse(auditSummary({ status: "queued", start_url: "https://exemplo.com.br/" })),
    );
    const { router } = renderRoute("/", { socket: new FakeSocket() });
    await submit("exemplo.com.br");
    const h1 = await screen.findByRole("heading", { level: 1, name: "Auditando exemplo.com.br" });
    expect(router.state.location.pathname).toBe(`/auditorias/${AUDIT_ID}`);
    expect(h1).toHaveFocus();
    expect(document.title).toBe("Auditando exemplo.com.br – Rampa");
  });

  it("enquanto cria, o botão diz Iniciando… e um segundo Enter não cria outra auditoria", async () => {
    let release: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
    renderRoute("/", { socket: new FakeSocket() });
    await submit("exemplo.com.br");
    expect(await screen.findByRole("button", { name: "Iniciando…" })).toHaveAttribute("aria-busy", "true");
    await userEvent.type(screen.getByRole("textbox"), "{Enter}");
    expect(posts()).toHaveLength(1);
    release(jsonResponse({ error: { code: "invalid_url", message: "x" } }, { status: 422 }));
  });

  it.each([
    ["unsupported_scheme", "ftp://exemplo.com", "Só endereços web (http:// ou https://) podem ser auditados."],
    ["unsupported_scheme", "javascript:alert(1)", "Só endereços web (http:// ou https://) podem ser auditados."],
    ["blocked_address", "http://localhost:4000", "Este endereço não pode ser auditado. O Rampa só acessa sites públicos."],
    ["invalid_url", "http://user:senha@exemplo.com", "Este endereço não é válido."],
    ["unresolvable", "nao-existe.exemplo", "Não encontramos este domínio. Confira se o endereço está certo."],
  ])("422 %s (%s): mensagem da API ligada ao campo, em alerta, com foco no campo; nada muda de tela", async (code, url, message) => {
    fetchMock.mockResolvedValue(apiRefusal(422, code, message));
    const { router, container } = renderRoute("/");
    await submit(url);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`Erro: ${message}`);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(new RegExp(`^Erro: ${message.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
    expect(input).toHaveFocus();
    expect(router.state.location.pathname).toBe("/");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("o mesmo erro duas vezes seguidas é anunciado de novo (alerta novo) e o foco volta ao campo", async () => {
    fetchMock.mockImplementation(async () => apiRefusal(422, "unresolvable", "Não encontramos este domínio."));
    renderRoute("/");
    await userEvent.type(screen.getByRole("textbox"), "nao-existe.exemplo");
    await userEvent.click(screen.getByRole("button", { name: "Auditar" }));
    const first = await screen.findByRole("alert");
    expect(screen.getByRole("textbox")).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Auditar" }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    const second = await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveFocus());
    expect(second).not.toBe(first);
    expect(second).toHaveTextContent("Não encontramos este domínio.");
  });

  it("vazio: pede o endereço sem chamar a API", async () => {
    renderRoute("/");
    await userEvent.click(screen.getByRole("button", { name: "Auditar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Cole o endereço do site que você quer auditar.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 rate_limited: diz a partir de que horas, no fuso de quem usa, sem marcar o campo inválido", async () => {
    const retry = new Date(Date.now() + 25 * 60_000);
    retry.setSeconds(0, 0);
    fetchMock.mockResolvedValue(
      apiRefusal(429, "rate_limited", "Você atingiu o limite de auditorias por hora. Tente de novo a partir das 99:99.", {
        retry_after: retry.toISOString(),
      }),
    );
    renderRoute("/");
    await submit("exemplo.com.br");
    // Horário do navegador, não o "99:99" da mensagem da API.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `Você atingiu o limite de auditorias por hora. Tente de novo a partir ${formatFrom(retry)}.`,
    );
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("429 sem retry_after: fica a mensagem da API", async () => {
    fetchMock.mockResolvedValue(apiRefusal(429, "daily_limit_reached", "O limite de auditorias de hoje acabou. Tente de novo amanhã."));
    renderRoute("/");
    await submit("exemplo.com.br");
    expect(await screen.findByRole("alert")).toHaveTextContent("O limite de auditorias de hoje acabou. Tente de novo amanhã.");
  });

  it("queda de rede: tenta uma vez sozinha e depois mostra a mensagem do cliente", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderRoute("/");
    await submit("exemplo.com.br");
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(
      "Não conseguimos falar com o Rampa. Confira a sua conexão e tente de novo.",
    );
    expect(posts()).toHaveLength(2);
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
});

describe("createAuditError", () => {
  const now = new Date(2026, 10, 12, 14, 0);

  it("daily_limit_reached com retry_after em outro dia diz a data e a hora", () => {
    const error = new ApiError("daily_limit_reached", "API", 429, new Date(2026, 10, 13, 0, 0));
    expect(createAuditError(error, now)).toEqual({
      message: "O limite de auditorias de hoje acabou. Tente de novo a partir de 13/11/2026, às 00:00.",
      invalid: false,
    });
  });

  it("rate_limited no mesmo dia diz só a hora", () => {
    const error = new ApiError("rate_limited", "API", 429, new Date(2026, 10, 12, 14, 32));
    expect(createAuditError(error, now).message).toBe(
      "Você atingiu o limite de auditorias por hora. Tente de novo a partir das 14:32.",
    );
  });

  it("dns_error e erro desconhecido não marcam o campo", () => {
    expect(createAuditError(new ApiError("dns_error", "Tente de novo.", 503), now)).toEqual({ message: "Tente de novo.", invalid: false });
    expect(createAuditError(new Error("x"), now).invalid).toBe(false);
  });
});
