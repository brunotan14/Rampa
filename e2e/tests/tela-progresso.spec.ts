import { expect, test, type Page } from "@playwright/test";
import { axeViolations } from "./a11y.js";
import {
  AUDIT_ID,
  PAGE_ID,
  PhoenixMock,
  TEXT_SPACING,
  ZERO,
  horizontalOverflow,
  liveRegionTexts,
  mockAuditApi,
  progress,
  recordLiveRegion,
} from "./simulado.js";

// Tela de progresso (TelaVarredura, RF-RA004) com a API e o canal `audit:<id>` simulados.
// Critérios: o contador sobe sem recarregar; a conclusão é anunciada uma única vez; depois de
// uma queda, a tela mostra o estado real. Mais axe nos três temas, reflow e espaçamento.

const PATH = `/auditorias/${AUDIT_ID}`;

async function openRunning(page: Page, found = 5) {
  const state = { revision: 1, progress: progress({ pages_found: found }) };
  const phoenix = new PhoenixMock(state);
  await phoenix.install(page);
  await mockAuditApi(page, state);
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Auditando exemplo.com.br" })).toBeVisible();
  await expect(page.getByText("Ao vivo")).toBeVisible();
  return phoenix;
}

function stat(page: Page, term: string) {
  return page.getByRole("definition").filter({ has: page.locator("xpath=preceding-sibling::dt[1]") }).and(
    page.locator(`xpath=//dt[normalize-space(.)="${term}"]/following-sibling::dd[1]`),
  );
}

test.describe("Tela de progresso (RF-RA004)", () => {
  test("RF-RA004 CA1: cada página terminada aumenta o contador de analisadas sem recarregar", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const phoenix = await openRunning(page);
    await recordLiveRegion(page);
    let navigations = 0;
    page.on("framenavigated", () => navigations++);

    for (let n = 1; n <= 5; n++) {
      phoenix.push("page_scanned", 1 + n, progress({ pages_found: 5, pages_scanned: n }), {
        page_id: PAGE_ID,
        counts_by_severity: ZERO,
        needs_review_count: 0,
      });
      await expect(stat(page, "Analisadas")).toHaveText(String(n));
    }
    expect(navigations).toBe(0);
    // Uma frase por página seria 5; os marcos de 25% respeitam o intervalo de 10 s.
    expect((await liveRegionTexts(page)).length).toBeLessThanOrEqual(1);
  });

  test("RF-RA004 CA2: ao terminar, 'Auditoria concluída: N problemas em M páginas' é anunciado uma única vez", async ({ page }) => {
    const phoenix = await openRunning(page, 1);
    await recordLiveRegion(page);
    const done = progress({ status: "completed", pages_found: 1, pages_scanned: 1, totals_by_severity: { ...ZERO, critical: 1, serious: 2 } });

    phoenix.push("audit_completed", 2, done, { score: null });
    await expect(page.getByRole("status")).toHaveText("Auditoria concluída: 3 problemas em 1 página.");
    // O fim chega de novo (evento repetido e o snapshot de uma reconexão): nada é repetido.
    phoenix.push("audit_completed", 2, done, { score: null });
    await phoenix.drop();
    await expect.poll(() => phoenix.joins).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1200);

    expect(await liveRegionTexts(page)).toEqual(["Auditoria concluída: 3 problemas em 1 página."]);
    await expect(page.getByRole("heading", { level: 1, name: "Auditoria de exemplo.com.br concluída" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver relatório" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // "Ver relatório": o relatório resumido com o foco no h1.
    await page.getByRole("button", { name: "Ver relatório" }).press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" })).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("RF-RA004 CA3: depois de perder a conexão, os contadores mostram o estado real quando ela volta", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const phoenix = await openRunning(page);
    phoenix.answerJoins = false;
    await phoenix.drop();
    await expect(page.getByText("Sem conexão. Tentando reconectar; os números podem estar atrasados.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // Durante a queda, a auditoria andou sem que a tela soubesse.
    phoenix.silently(9, progress({ pages_found: 5, pages_scanned: 4, pages_failed: 1, totals_by_severity: { ...ZERO, moderate: 6 } }));
    phoenix.answerJoins = true;
    await phoenix.drop(); // a próxima conexão responde o join com o estado atual

    await expect(page.getByText("Ao vivo")).toBeVisible();
    await expect(stat(page, "Analisadas")).toHaveText("4");
    await expect(stat(page, "Com falha")).toHaveText("1");
    await expect(stat(page, "Moderados")).toHaveText("6");
  });

  test("falha: o motivo aparece na tela e é anunciado uma vez", async ({ page }) => {
    const phoenix = await openRunning(page, 1);
    await recordLiveRegion(page);
    const reason = "A página demorou demais para carregar ou para ser analisada.";
    phoenix.push("audit_failed", 2, progress({ status: "failed", pages_found: 1, pages_failed: 1, error: { code: "timeout", message: reason } }));
    await expect(page.getByRole("heading", { level: 1, name: "A auditoria de exemplo.com.br parou" })).toBeVisible();
    await expect(page.getByText(reason, { exact: false }).first()).toBeVisible();
    expect(await liveRegionTexts(page)).toEqual([`A auditoria parou. ${reason}`]);
    expect(await axeViolations(page)).toEqual([]);
  });

  for (const media of [{ colorScheme: "light" }, { colorScheme: "dark" }, { contrast: "more" }, { forcedColors: "active" }] as const) {
    test(`não tem violações do axe em andamento (${JSON.stringify(media)})`, async ({ page }) => {
      await page.emulateMedia(media);
      await openRunning(page);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("h1 igual ao título, marcos, e uma única região viva", async ({ page }) => {
    await openRunning(page);
    await expect(page).toHaveTitle("Auditando exemplo.com.br – Rampa");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveAttribute("id", "conteudo");
    await expect(page.locator("[aria-live], [role=status], [role=alert], [role=log]")).toHaveCount(1);
    await expect(page.getByRole("progressbar", { name: "Analisando o site…" })).toHaveAttribute("aria-valuetext", /páginas verificadas/);
  });

  test("320px, zoom de 200% e espaçamento de texto não criam rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openRunning(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 640, height: 480 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.addStyleTag({ content: TEXT_SPACING });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("progressbar")).toBeVisible();
  });

  test("auditoria já concluída ao abrir: relatório resumido, sem anúncio", async ({ page }) => {
    const state = { revision: 3, progress: progress({ status: "completed", pages_scanned: 1, totals_by_severity: { ...ZERO, minor: 2 } }) };
    await new PhoenixMock(state).install(page);
    await mockAuditApi(page, state);
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1, name: "Relatório de exemplo.com.br" })).toBeVisible();
    await expect(page.locator('xpath=//dt[normalize-space(.)="Problemas confirmados"]/following-sibling::dd[1]')).toHaveText("2");
    await expect(page.getByRole("button", { name: "Auditar de novo" })).toBeVisible();
    // A região viva existe (montada vazia desde o primeiro quadro), mas nada é anunciado.
    await expect(page.locator("[aria-live]")).toHaveCount(1);
    await expect(page.locator("[aria-live]")).toBeEmpty();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("canal recusado (limite de canais): a tela segue pelo resumo, com o aviso de sem atualização ao vivo", async ({ page }) => {
    const state = { revision: 1, progress: progress({ pages_found: 5, pages_scanned: 2 }) };
    await mockAuditApi(page, state);
    await page.routeWebSocket(/\/socket\/websocket/, (ws) => {
      ws.onMessage((raw) => {
        const [joinRef, ref, topic, event] = JSON.parse(String(raw)) as [string, string, string, string];
        if (event === "phx_join") {
          ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "error", response: { error: { code: "channel_limit_reached", message: "Limite de canais." } } }]));
        } else if (event === "heartbeat") {
          ws.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
        }
      });
    });
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1, name: "Auditando exemplo.com.br" })).toBeVisible();
    await expect(page.getByText("Os números são atualizados a cada 30 segundos.")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(stat(page, "Analisadas")).toHaveText("2");
    expect(await axeViolations(page)).toEqual([]);
  });

  test("404: auditoria inexistente mostra o erro e o caminho de volta", async ({ page }) => {
    await page.route(`**/api/audits/${AUDIT_ID}**`, (route) =>
      route.fulfill({ status: 404, json: { error: { code: "audit_not_found", message: "Auditoria não encontrada. Confira o endereço do relatório." } } }),
    );
    await page.routeWebSocket(/\/socket\/websocket/, (ws) => {
      ws.onMessage((raw) => {
        const [joinRef, ref, topic, event] = JSON.parse(String(raw)) as [string, string, string, string];
        if (event === "phx_join") {
          ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "error", response: { error: { code: "audit_not_found", message: "Auditoria não encontrada. Confira o endereço do relatório." } } }]));
        } else if (event === "heartbeat") {
          ws.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
        }
      });
    });
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1, name: "Auditoria não encontrada" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Auditoria não encontrada. Confira o endereço do relatório.");
    expect(await axeViolations(page)).toEqual([]);
  });
});
