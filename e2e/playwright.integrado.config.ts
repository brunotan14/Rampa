import { defineConfig } from "@playwright/test";
import { env } from "./integrado/support/env.js";

// E2E integrado (PRD §11.2): API, scanner e site de fixtures reais, no Compose de teste
// (`infra/docker-compose.test.yml`). Roda só dentro do serviço `e2e` do Compose, pelo
// `make e2e-integrado`. As telas do Rampa continuam em `playwright.config.ts` (`make e2e`).
//
// Saída em `out/` (no host, `e2e/test-results/integrado/`): `artifacts/` com os traces das
// falhas e `report/` com o relatório HTML.
export default defineConfig({
  testDir: "integrado",
  outputDir: "out/artifacts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Sem novas tentativas: o teto diário e o balde do IP não confiável não se repetem.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 120_000,
  reporter: [
    ["list"],
    ...(process.env.CI ? [["github"] as const] : []),
    ["html", { outputFolder: "out/report", open: "never" }],
  ],
  use: {
    baseURL: env.apiUrl,
    extraHTTPHeaders: { accept: "application/json" },
    trace: "retain-on-failure",
  },
  projects: [{ name: "integrado" }],
});
