import { launchBrowser } from "./browser.js";
import { buildServer, DEFAULT_TOTAL_TIMEOUT_MS } from "./server.js";
import { parseAllowlist } from "./ssrf/policy.js";

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "127.0.0.1";
const totalTimeoutMs = Number(process.env.SCAN_TOTAL_TIMEOUT_MS ?? DEFAULT_TOTAL_TIMEOUT_MS);

if (!Number.isInteger(totalTimeoutMs) || totalTimeoutMs <= 0) {
  throw new Error(`SCAN_TOTAL_TIMEOUT_MS inválido: ${process.env.SCAN_TOTAL_TIMEOUT_MS}`);
}

// Hosts liberados da checagem de nome e de IP (RF-RA002). Só o Compose de teste preenche.
const allowlist = parseAllowlist(process.env.SSRF_ALLOWLIST);

const browser = await launchBrowser();
const app = buildServer(browser, { totalTimeoutMs, ssrf: { allowlist: new Set(allowlist) } });

if (allowlist.length > 0) {
  app.log.warn(
    `SSRF_ALLOWLIST preenchida: ${allowlist.join(", ")} sem checagem de nome e de IP. Use só no Compose de teste.`,
  );
}

const shutdown = async () => {
  await app.close();
  await browser.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port, host });
