import { expect, test } from "@playwright/test";
import { fixtureUrl, newClientIp } from "./support/api.js";
import { env } from "./support/env.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";

// PRD §7 (Hospedagem e deploy) e RNF-RA008: a release do app serve o build do React na mesma
// origem da API e do canal, com a CSP restritiva. O navegador real precisa rodar a interface
// inteira (scripts, estilos, fontes, websocket) sem nenhuma violação da CSP.

const SERVE =
  "PRD §7: o app serve o build do React em priv/static; rotas da interface caem no index.html.";
const CSP = "RNF-RA008: CSP restritiva e headers de segurança.";

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test(
  "o app serve a interface com a CSP, sem violação do início ao canal da auditoria",
  { annotation: [requirement(SERVE), requirement(CSP)] },
  async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: env.webUrl,
      locale: "pt-BR",
      reducedMotion: "reduce",
      extraHTTPHeaders: { "X-Forwarded-For": newClientIp() },
    });
    // Toda violação da CSP vira um evento `securitypolicyviolation` no documento.
    await context.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
      document.addEventListener("securitypolicyviolation", (event) => {
        seen.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    const page = await context.newPage();

    const home = await page.goto("/");
    const headers = home?.headers() ?? {};
    await page.getByRole("textbox", { name: "Endereço do site" }).fill(fixtureUrl("img-sem-alt.html"));
    await page.getByRole("button", { name: "Auditar" }).click();
    await page.waitForURL(/\/auditorias\/[0-9a-f-]{36}$/);
    // O canal em tempo real (websocket da mesma origem) leva a tela até o fim da auditoria.
    await expect(page.getByRole("button", { name: "Ver relatório" })).toBeVisible({ timeout: 60_000 });

    // Cada documento tem a sua lista: lê a da tela atual antes de navegar de novo.
    const readViolations = () =>
      page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
    const violations = await readViolations();

    // Link direto para uma rota da interface: o app devolve o index.html, e o React decide.
    const deep = await page.goto(new URL(page.url()).pathname);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    violations.push(...(await readViolations()));
    await attachObserved(testInfo, {
      status: home?.status(),
      headers,
      deepLink: { status: deep?.status(), contentType: deep?.headers()["content-type"] },
      violations,
    });

    expect(home?.status()).toBe(200);
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["cache-control"]).toBe("no-cache");
    expect(deep?.status()).toBe(200);
    expect(deep?.headers()["content-type"]).toMatch(/^text\/html/);
    expect(violations).toEqual([]);
    await context.close();
  },
);
