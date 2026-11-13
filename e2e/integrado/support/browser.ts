import type { Browser } from "@playwright/test";
import { newClientIp } from "./api.js";
import { env } from "./env.js";

// Navegador nos casos que olham a tela: o frontend servido pelo próprio app (`env.webUrl`), com
// o IP simulado no `X-Forwarded-For` (o mesmo balde do limite de taxa que a API usa) e sem
// movimento, para a tela aparecer pronta.
export async function openBrowserPage(browser: Browser, clientIp: string = newClientIp()) {
  const context = await browser.newContext({
    baseURL: env.webUrl,
    locale: "pt-BR",
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": clientIp },
  });
  const page = await context.newPage();
  return { context, page, clientIp };
}
