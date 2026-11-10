import { chromium } from "playwright";
import { buildServer, DEFAULT_TOTAL_TIMEOUT_MS } from "./server.js";

const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? "127.0.0.1";
const totalTimeoutMs = Number(process.env.SCAN_TOTAL_TIMEOUT_MS ?? DEFAULT_TOTAL_TIMEOUT_MS);

if (!Number.isInteger(totalTimeoutMs) || totalTimeoutMs <= 0) {
  throw new Error(`SCAN_TOTAL_TIMEOUT_MS inválido: ${process.env.SCAN_TOTAL_TIMEOUT_MS}`);
}

const browser = await chromium.launch();
const app = buildServer(browser, { totalTimeoutMs });

const shutdown = async () => {
  await app.close();
  await browser.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port, host });
