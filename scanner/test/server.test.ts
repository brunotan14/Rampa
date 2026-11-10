import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

const fixturesDir = new URL("./fixtures/", import.meta.url);

let browser: Browser;
let app: FastifyInstance;
let fixtures: Server;
let fixturesUrl: string;

beforeAll(async () => {
  fixtures = createServer(async (req, res) => {
    try {
      const body = await readFile(new URL(`.${req.url}`, fixturesDir));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => fixtures.listen(0, "127.0.0.1", resolve));
  fixturesUrl = `http://127.0.0.1:${(fixtures.address() as AddressInfo).port}`;

  browser = await chromium.launch();
  app = buildServer(browser);
});

afterAll(async () => {
  await app.close();
  await browser.close();
  fixtures.close();
});

describe("GET /health", () => {
  it("responde ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /scan", () => {
  it("devolve título e status HTTP da página", async () => {
    const res = await app.inject({ method: "POST", url: "/scan", payload: { url: `${fixturesUrl}/limpa.html` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      final_url: `${fixturesUrl}/limpa.html`,
      http_status: 200,
      title: "Página limpa",
    });
  });

  it("recusa URL que não é http ou https", async () => {
    const res = await app.inject({ method: "POST", url: "/scan", payload: { url: "ftp://exemplo.com" } });
    expect(res.statusCode).toBe(400);
  });

  it("devolve navigation_failed quando a página não abre", async () => {
    const res = await app.inject({ method: "POST", url: "/scan", payload: { url: "http://127.0.0.1:1/" } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("navigation_failed");
  });
});
