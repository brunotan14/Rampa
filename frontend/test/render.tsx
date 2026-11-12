import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import axe from "axe-core";
import { AuditSocketProvider, type SocketLike } from "../src/api/channel";
import { routes } from "../src/routes";

/** QueryClient de teste: sem novas tentativas nem cache entre testes. */
export function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function withQueryClient(client = testQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

export interface RenderRouteOptions {
  strict?: boolean;
  /** Socket do canal (`FakeSocket`); sem ele, o app usaria o socket de verdade. */
  socket?: SocketLike;
  client?: QueryClient;
}

export function renderRoute(path = "/", { strict = false, socket, client = testQueryClient() }: RenderRouteOptions = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const Wrapper = withQueryClient(client);
  const app = <RouterProvider router={router} />;
  const ui = <Wrapper>{socket ? <AuditSocketProvider socket={socket}>{app}</AuditSocketProvider> : app}</Wrapper>;
  return { router, client, ...render(strict ? <StrictMode>{ui}</StrictMode> : ui) };
}

// Contraste não é calculado no jsdom; ele é coberto pelo E2E num navegador real.
export async function axeViolations(container: Element) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}

/** Resposta JSON para `fetch` falso. */
export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}
