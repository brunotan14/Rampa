import { launchBrowser } from "./browser.js";
import { buildServer, DEFAULT_TOTAL_TIMEOUT_MS } from "./server.js";
import { checkStartup, parseAllowlist } from "./ssrf/policy.js";

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "127.0.0.1";
const totalTimeoutMs = Number(process.env.SCAN_TOTAL_TIMEOUT_MS ?? DEFAULT_TOTAL_TIMEOUT_MS);

if (!Number.isInteger(totalTimeoutMs) || totalTimeoutMs <= 0) {
  throw new Error(`SCAN_TOTAL_TIMEOUT_MS inválido: ${process.env.SCAN_TOTAL_TIMEOUT_MS}`);
}

// Hosts liberados da checagem de nome e de IP (RF-RA002). Só o Compose de teste preenche;
// em produção o scanner se recusa a subir com ela preenchida.
const allowlist = parseAllowlist(process.env.SSRF_ALLOWLIST);
const startup = checkStartup(process.env.NODE_ENV, allowlist);
if (!startup.ok) {
  console.error(startup.reason);
  process.exit(1);
}

const browser = await launchBrowser();
const app = buildServer(browser, { totalTimeoutMs, ssrf: { allowlist: new Set(allowlist) } });
if (startup.warning) app.log.warn(startup.warning);

const shutdown = async () => {
  await app.close();
  await browser.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port, host });
