import type { BrowserContext, Page, Request } from "playwright";
import { checkUrl, type BlockReason, type SsrfPolicy } from "./policy.js";

// O route classifica e conta (RF-RA002); quem busca é o Chromium, pelo proxy de saída da
// varredura (`proxy.ts`), que valida cada conexão. O route nunca atende a requisição
// (`fulfill`): só deixa seguir (`continue`) ou recusa (`abort`).
//
//   * documento principal com URL recusada ou porta fora das permitidas: a varredura devolve
//     o motivo (`blocked_address` ou `invalid_url`);
//   * sub-recurso recusado: `abort` e soma em `blockedRequests`. Ele não chega ao proxy,
//     então não é contado duas vezes.
//
// O route não vê o salto de um redirecionamento, o WebSocket nem as requisições de alguns
// workers: o proxy bloqueia esses e registra.

export interface RouteState {
  blockedRequests: number;
  documentBlocked: { reason: BlockReason; detail: string } | null;
}

export async function classifyRequests(
  context: BrowserContext,
  mainPage: () => Page | undefined,
  policy: SsrfPolicy,
): Promise<RouteState> {
  const state: RouteState = { blockedRequests: 0, documentBlocked: null };

  const isMainDocument = (request: Request) => {
    try {
      return request.isNavigationRequest() && request.frame() === mainPage()?.mainFrame();
    } catch {
      // Requisição sem frame (ex.: de service worker, que fica bloqueado no contexto).
      return false;
    }
  };

  await context.route("**/*", async (route, request) => {
    try {
      const url = request.url();
      // `data:` e `blob:` não vão para a rede; o Playwright nem os entrega ao route.
      if (url.startsWith("data:") || url.startsWith("blob:")) return await route.continue();

      const document = isMainDocument(request);
      const check = checkUrl(url, policy, document ? "document" : "subresource");
      if (check.ok) return await route.continue();

      if (document) state.documentBlocked ??= { reason: check.reason, detail: check.detail };
      else state.blockedRequests += 1;
      await route.abort("blockedbyclient");
    } catch {
      // Contexto fechado no meio (prazo total estourado) ou requisição já encerrada.
      await route.abort("failed").catch(() => {});
    }
  });

  return state;
}
