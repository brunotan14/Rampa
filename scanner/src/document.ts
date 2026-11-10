import type { Page, Request, Response } from "playwright";
import { BLOCKED_HEADER, urlTargetKey } from "./ssrf/proxy.js";

// Acompanha o documento principal da página: todas as requisições de navegação (com os
// saltos de redirecionamento), o status da última resposta e se ainda há navegação em
// andamento. Serve para:
//   * casar um bloqueio do proxy com o documento (`refusedTargets`), o que vira
//     `blocked_address`. Vale a requisição do documento, não o host: um sub-recurso
//     bloqueado no mesmo host não derruba a varredura;
//   * esperar a navegação que a página dispara sozinha logo depois de abrir (ex.: no
//     `onload`), para analisar o destino real (`settle`).

const SETTLE_MS = 500;
const POLL_MS = 50;

export interface DocumentTracker {
  // `host:porta` de cada requisição de navegação do documento principal, inclusive saltos.
  readonly targets: ReadonlySet<string>;
  // `host:porta` das requisições do documento que falharam ou que o proxy recusou com o
  // cabeçalho de bloqueio.
  readonly refusedTargets: ReadonlySet<string>;
  // Status da última resposta do documento principal que não é redirecionamento.
  readonly status: number | null;
  // Espera não haver navegação em andamento por `SETTLE_MS`. `false` se o prazo acabou antes.
  settle(deadline: number): Promise<boolean>;
}

const root = (request: Request) => {
  let current = request;
  for (let previous = current.redirectedFrom(); previous; previous = current.redirectedFrom()) current = previous;
  return current;
};

export function trackDocument(page: Page, blockedToken: string): DocumentTracker {
  const targets = new Set<string>();
  const refusedTargets = new Set<string>();
  const refuse = (url: string) => {
    const key = urlTargetKey(url);
    if (key) refusedTargets.add(key);
  };
  const pending = new Set<Request>();
  let committing = false;
  let status: number | null = null;

  const isMain = (request: Request) => {
    try {
      return request.isNavigationRequest() && request.frame() === page.mainFrame();
    } catch {
      return false;
    }
  };

  page.on("request", (request) => {
    if (!isMain(request)) return;
    const key = urlTargetKey(request.url());
    if (key) targets.add(key);
    if (!request.redirectedFrom()) pending.add(request);
  });

  page.on("requestfailed", (request) => {
    if (!isMain(request)) return;
    refuse(request.url());
    pending.delete(root(request));
  });

  page.on("response", (response: Response) => {
    const request = response.request();
    if (!isMain(request)) return;
    const code = response.status();
    if (response.headers()[BLOCKED_HEADER] === blockedToken) refuse(request.url());
    if (code >= 300 && code < 400 && response.headers().location !== undefined) return;
    pending.delete(root(request));
    status = code;
    // 204 e 205 não trocam o documento: não haverá `load`.
    committing = code !== 204 && code !== 205;
  });

  page.on("load", () => (committing = false));
  page.on("download", () => (committing = false));

  return {
    targets,
    refusedTargets,
    get status() {
      return status;
    },
    async settle(deadline) {
      let quietSince = Date.now();
      for (;;) {
        const now = Date.now();
        if (pending.size > 0 || committing) quietSince = now;
        else if (now - quietSince >= SETTLE_MS) return true;
        if (now >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
  };
}
