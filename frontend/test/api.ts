// `fetch` falso por caminho da API, para os testes das telas. Cada rota responde um corpo JSON
// (200) ou uma função que recebe a URL (para conferir os parâmetros e responder erros).
import { vi } from "vitest";
import { jsonResponse } from "./render";

export type Handler = unknown | ((url: URL, init?: RequestInit) => Response | Promise<Response>);

export function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const handler = routes[url.pathname];
    if (handler === undefined) throw new Error(`sem resposta para ${url.pathname}${url.search}`);
    return typeof handler === "function"
      ? (handler as (url: URL, init?: RequestInit) => Response | Promise<Response>)(url, init)
      : jsonResponse(handler);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    /** URLs pedidas a um caminho, na ordem. */
    calls: (pathname: string) =>
      fetchMock.mock.calls
        .map(([input]) => new URL(String(input), "http://localhost"))
        .filter((url) => url.pathname === pathname),
  };
}

export const apiError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  jsonResponse({ error: { code, message, ...extra } }, { status });
