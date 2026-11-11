import { expect, test } from "@playwright/test";
import { apiError, createAudit, fixtureUrl, newClientIp, postAudit, retryAfterSeconds } from "./support/api.js";
import { env, limits } from "./support/env.js";
import { attachObserved, requireObserved, requirement } from "./support/evidence.js";
import { messages } from "./support/messages.js";
import { saoPauloTime } from "./support/time.js";

// RF-RA002: limites de taxa. Cada caso usa um balde próprio e não divide com nenhum outro
// spec (ver "Limites" no README desta pasta):
//   - limite por IP: um IP simulado novo no `env.apiUrl`;
//   - X-Forwarded-For fora da faixa confiável: o balde único do `env.apiDirectUrl`;
//   - teto diário: a instância `env.apiDailyUrl`, com banco próprio.
// Os dois últimos só aguentam uma execução por ambiente: com o ambiente de pé, rodar de novo
// exige `make e2e-integrado-down` e `make e2e-integrado-up`.

const CA4 =
  "RF-RA002 CA4: Dado que fiz 5 auditorias na última hora, quando inicio a sexta, então recebo a mensagem de limite com o horário em que poderei tentar de novo.";
const TRUSTED_PROXIES_RULE =
  "RF-RA002 (regra do limite de taxa): o `X-Forwarded-For` só é considerado quando a conexão vem de uma faixa em `TRUSTED_PROXIES` (o Traefik); fora disso vale o IP da conexão.";
const DAILY_LIMIT_RULE =
  "RF-RA002 (regra do teto global diário): `AUDITS_DAILY_LIMIT`. Excedido: a tela explica que o limite do dia acabou.";

const ONE_HOUR_MS = 3_600_000;
const ONE_MINUTE_MS = 60_000;

test.afterEach(async ({}, testInfo) => requireObserved(testInfo));

test.describe("RF-RA002: limites de taxa", () => {
  test(
    "RF-RA002 CA4: a sexta auditoria do mesmo IP na hora recebe 429 com o horário de nova tentativa",
    { annotation: requirement(CA4) },
    async ({ request }, testInfo) => {
      const clientIp = newClientIp();
      for (let created = 0; created < limits.perIpPerHour; created++) {
        await createAudit(request, fixtureUrl("limpa.html"), { clientIp });
      }

      const sentAt = Date.now();
      const sixth = await postAudit(request, fixtureUrl("limpa.html"), { clientIp });
      const retryAfterHeader = retryAfterSeconds(sixth);
      await attachObserved(testInfo, {
        status: sixth.status,
        body: sixth.body,
        retryAfterHeader,
        sentAt: new Date(sentAt).toISOString(),
      });

      expect(sixth.status, JSON.stringify(sixth.body)).toBe(429);
      const error = apiError(sixth);
      expect(error.code).toBe("rate_limited");
      expect(error.message).toMatch(messages.rateLimited);

      // O horário da mensagem é o `retry_after` (UTC) em São Paulo, arredondado para cima no
      // minuto: fica entre 1 h e 1 h + 1 min depois da 1ª auditoria, que é de antes do envio.
      const retryAt = Date.parse(error.retry_after ?? "");
      expect(retryAt).toBeGreaterThan(sentAt);
      expect(retryAt).toBeLessThanOrEqual(sentAt + ONE_HOUR_MS + ONE_MINUTE_MS);
      expect(error.message.match(messages.rateLimited)?.[1]).toBe(saoPauloTime(error.retry_after!));

      expect(retryAfterHeader).toBeGreaterThanOrEqual(1);
      expect(Math.abs(sentAt + retryAfterHeader * 1000 - retryAt)).toBeLessThanOrEqual(5_000);
    },
  );

  test(
    "RF-RA002: X-Forwarded-For vindo de faixa não confiável não fura o limite por IP",
    { annotation: requirement(TRUSTED_PROXIES_RULE) },
    async ({ request }, testInfo) => {
      // Pela faixa não confiável, cada pedido traz um X-Forwarded-For diferente. Se o app o
      // aceitasse, seriam seis IPs com uma auditoria cada; como vale o IP da conexão, é um IP
      // só, e a sexta passa do limite.
      const forwardedFor: string[] = [];
      for (let created = 0; created < limits.perIpPerHour; created++) {
        const { clientIp } = await createAudit(request, fixtureUrl("limpa.html"), { baseURL: env.apiDirectUrl });
        forwardedFor.push(clientIp!);
      }

      const sixth = await postAudit(request, fixtureUrl("limpa.html"), { baseURL: env.apiDirectUrl });
      await attachObserved(testInfo, {
        forwardedFor: [...forwardedFor, sixth.clientIp],
        status: sixth.status,
        body: sixth.body,
        retryAfterHeader: retryAfterSeconds(sixth),
      });

      expect(new Set([...forwardedFor, sixth.clientIp]).size).toBe(limits.perIpPerHour + 1);
      expect(sixth.status, JSON.stringify(sixth.body)).toBe(429);
      const error = apiError(sixth);
      expect(error.code).toBe("rate_limited");
      expect(error.message).toMatch(messages.rateLimited);
    },
  );

  test(
    "RF-RA002: passado o teto diário, a próxima auditoria recebe 429 daily_limit_reached",
    { annotation: requirement(DAILY_LIMIT_RULE) },
    async ({ request }, testInfo) => {
      // IPs diferentes a cada pedido: o teto é global, não por IP.
      for (let created = 0; created < limits.dailyOfDailyApp; created++) {
        await createAudit(request, fixtureUrl("limpa.html"), { baseURL: env.apiDailyUrl });
      }

      const sentAt = Date.now();
      const next = await postAudit(request, fixtureUrl("limpa.html"), { baseURL: env.apiDailyUrl });
      const retryAfterHeader = retryAfterSeconds(next);
      await attachObserved(testInfo, {
        status: next.status,
        body: next.body,
        retryAfterHeader,
        sentAt: new Date(sentAt).toISOString(),
      });

      expect(next.status, JSON.stringify(next.body)).toBe(429);
      const error = apiError(next);
      expect(error).toMatchObject({ code: "daily_limit_reached", message: messages.dailyLimitReached });

      // Nova tentativa na próxima meia-noite de São Paulo, dentro das próximas 24 h.
      const retryAt = Date.parse(error.retry_after ?? "");
      expect(retryAt).toBeGreaterThan(sentAt);
      expect(retryAt).toBeLessThanOrEqual(sentAt + 24 * ONE_HOUR_MS);
      expect(saoPauloTime(error.retry_after!)).toBe("00:00");
      expect(retryAfterHeader).toBeGreaterThanOrEqual(1);
    },
  );
});
