import type { BrowserContext, Page, Request, Route } from "playwright";
import {
  fetchResource,
  isBlockedError,
  TooLargeError,
  type FetchLimits,
} from "./fetch.js";
import { checkUrl, type SsrfPolicy } from "./policy.js";

// Intercepta **toda** requisição do contexto (RF-RA002) e a atende com `fetchResource`,
// que valida o IP na conexão. O Chromium não tem saída de rede própria (`launchBrowser`):
// o que não passa por aqui falha.
//
// O Playwright não intercepta o salto de um redirecionamento: a requisição seguinte é
// continuada direto na rede. Por isso o route nunca devolve 3xx ao navegador:
//   * documento principal durante a abertura da página: o route entrega um documento vazio
//     só com os Set-Cookie do redirecionamento (o Chromium os aplica com as regras dele) e
//     guarda o destino (`documentRedirect`); quem chamou navega de novo para ele, e essa
//     navegação nova passa por aqui;
//   * qualquer outra requisição: o Node segue o redirecionamento, validando cada salto.

export interface InterceptState {
  // Sub-recursos recusados pela proteção (contrato do scanner, PRD §7).
  blockedRequests: number;
  // Documento principal recusado: a varredura devolve `blocked_address`.
  documentBlocked: string | null;
  // Destino do redirecionamento do documento principal durante a abertura.
  documentRedirect: string | null;
  // Motivo da falha ao buscar o documento principal (DNS, conexão, tamanho).
  documentError: string | null;
  // Enquanto `true`, o redirecionamento do documento principal volta para quem chamou.
  opening: boolean;
}

export async function interceptRequests(
  context: BrowserContext,
  mainPage: () => Page | undefined,
  policy: SsrfPolicy,
  limits: FetchLimits,
  signal: AbortSignal,
): Promise<InterceptState> {
  const state: InterceptState = {
    blockedRequests: 0,
    documentBlocked: null,
    documentRedirect: null,
    documentError: null,
    opening: true,
  };

  const isMainDocument = (request: Request) => {
    try {
      return request.isNavigationRequest() && request.frame() === mainPage()?.mainFrame();
    } catch {
      // Requisição sem frame (ex.: de service worker, que fica bloqueado no contexto).
      return false;
    }
  };

  const refuse = async (route: Route, document: boolean, detail: string) => {
    if (document) state.documentBlocked ??= detail;
    else state.blockedRequests += 1;
    await route.abort("blockedbyclient");
  };

  async function handle(route: Route, request: Request) {
    const url = request.url();
    // `data:` e `blob:` não vão para a rede; o Playwright nem os entrega ao route.
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.fallback();

    const document = isMainDocument(request);
    const kind = document ? "document" : "subresource";
    const check = checkUrl(url, policy, kind);
    if (!check.ok) return refuse(route, document, check.detail);

    const handBack = document && state.opening;
    try {
      const response = await fetchResource(
        {
          url,
          method: request.method(),
          headers: await request.allHeaders(),
          body: request.postDataBuffer(),
        },
        policy,
        { kind, followRedirects: !handBack, limits, signal },
      );
      const location = response.headers.location;
      if (handBack && response.status >= 300 && response.status < 400 && location !== undefined) {
        state.documentRedirect = new URL(location, url).href;
        const cookies = response.headers["set-cookie"];
        return route.fulfill({
          status: 200,
          headers: { "content-type": "text/html", ...(cookies ? { "set-cookie": cookies } : {}) },
          body: "",
        });
      }
      return route.fulfill({ status: response.status, headers: response.headers, body: response.body });
    } catch (error) {
      if (isBlockedError(error)) return refuse(route, document, error.message);
      if (document) state.documentError ??= error instanceof Error ? error.message : String(error);
      return route.abort(abortCode(error));
    }
  }

  await context.route("**/*", async (route, request) => {
    try {
      await handle(route, request);
    } catch {
      // Contexto fechado no meio (prazo total estourado) ou requisição já cancelada.
      await route.abort("failed").catch(() => {});
    }
  });

  return state;
}

function abortCode(error: unknown) {
  if (error instanceof TooLargeError) return "failed";
  switch ((error as { code?: string } | null)?.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "namenotresolved";
    case "ECONNREFUSED":
      return "connectionrefused";
    case "ECONNRESET":
      return "connectionreset";
    case "ETIMEDOUT":
      return "timedout";
    default:
      return "failed";
  }
}
