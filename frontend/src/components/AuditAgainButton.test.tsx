import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
import { apiError, stubApi } from "../../test/api";
import { auditSummary } from "../../test/fixtures";
import { axeViolations, testQueryClient } from "../../test/render";
import { AuditAgainButton } from "./AuditAgainButton";

const NEW_ID = "11111111-2222-4333-8444-555555555555";

function NewAudit() {
  return <p>nova {useParams().id}</p>;
}

function renderButton() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <AuditAgainButton startUrl="https://exemplo.com.br/" pageLimit={1} /> },
      { path: "/auditorias/:id", element: <NewAudit /> },
    ],
    { initialEntries: ["/"] },
  );
  return { router, ...render(<QueryClientProvider client={testQueryClient()}><RouterProvider router={router} /></QueryClientProvider>) };
}

afterEach(() => vi.unstubAllGlobals());

describe("AuditAgainButton (RF-RA029)", () => {
  it("cria uma nova auditoria com a mesma URL e o mesmo limite, chave nova, e leva ao progresso dela", async () => {
    const api = stubApi({
      "/api/audits": () => new Response(JSON.stringify({ id: NEW_ID }), { status: 202, headers: { "Content-Type": "application/json" } }),
      [`/api/audits/${NEW_ID}`]: auditSummary({ id: NEW_ID, status: "queued" }),
    });
    const { router } = renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Auditar de novo" }));
    expect(await screen.findByText(`nova ${NEW_ID}`)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/auditorias/${NEW_ID}`);

    const [, init] = api.fetchMock.mock.calls.find(([url]) => String(url) === "/api/audits")!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ url: "https://exemplo.com.br/", page_limit: 1 });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{32,36}$/);
  });

  it("429: mostra o horário de liberação em alerta, ligado ao botão, e o foco fica no botão", async () => {
    const retryAfter = new Date(Date.now() + 30 * 60_000);
    stubApi({
      "/api/audits": () =>
        apiError(429, "rate_limited", "Você atingiu o limite.", { retry_after: retryAfter.toISOString() }),
    });
    const { container } = renderButton();
    const button = screen.getByRole("button", { name: "Auditar de novo" });
    await userEvent.click(button);
    const alert = await screen.findByRole("alert");
    const hhmm = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(retryAfter);
    expect(alert).toHaveTextContent(`Você atingiu o limite de auditorias por hora. Tente de novo a partir`);
    expect(alert).toHaveTextContent(hhmm);
    expect(button).toHaveAccessibleDescription(alert.textContent!);
    expect(button).toHaveFocus();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("cada clique depois de um erro definitivo usa uma chave nova; depois de um 429, a mesma", async () => {
    const keys: string[] = [];
    let status = 422;
    stubApi({
      "/api/audits": (_url: URL, init?: RequestInit) => {
        keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
        return status === 429
          ? apiError(429, "rate_limited", "Limite.", { retry_after: new Date(Date.now() + 60_000).toISOString() })
          : apiError(422, "blocked_address", "Este endereço não pode ser auditado.");
      },
    });
    renderButton();
    const button = screen.getByRole("button", { name: "Auditar de novo" });
    await userEvent.click(button);
    await screen.findByRole("alert");
    await userEvent.click(button);
    await screen.findByRole("alert");
    status = 429;
    await userEvent.click(button);
    await screen.findByText(/Tente de novo a partir/);
    await userEvent.click(button);
    await screen.findByText(/Tente de novo a partir/);
    expect(keys).toHaveLength(4);
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[3]).toBe(keys[2]);
  });
});
