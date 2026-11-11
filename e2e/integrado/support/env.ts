// Endereços do Compose de teste, vistos de dentro do serviço `e2e`
// (`infra/docker-compose.test.yml`). Fora dele os nomes não resolvem: rode pelo
// `make e2e-integrado`.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} não está definida. Os E2E integrados rodam dentro do Compose de teste: use \`make e2e-integrado\`.`,
    );
  }
  return value.replace(/\/+$/, "");
}

export const env = {
  /** App pela faixa confiável (`TRUSTED_PROXIES`): o `X-Forwarded-For` vale. */
  apiUrl: required("RAMPA_API_URL"),
  /** App pela faixa NÃO confiável: o `X-Forwarded-For` é ignorado e vale o IP da conexão. */
  apiDirectUrl: required("RAMPA_API_DIRECT_URL"),
  /** Instância com teto diário baixo (`AUDITS_DAILY_LIMIT=3`) e banco próprio, pela faixa confiável. */
  apiDailyUrl: required("RAMPA_API_DAILY_URL"),
  /** Scanner, chamado direto (`POST /scan`). */
  scannerUrl: required("RAMPA_SCANNER_URL"),
  /** Site de fixtures como o app e o scanner o enxergam (liberado pela `SSRF_ALLOWLIST`). */
  fixturesUrl: required("RAMPA_FIXTURES_URL"),
  /** Faixa confiável configurada no app, para conferência. */
  trustedProxies: required("RAMPA_TRUSTED_PROXIES"),
};

/** Limites configurados no Compose de teste. */
export const limits = {
  /** `AUDITS_PER_IP_PER_HOUR` do `app` (o valor do PRD). */
  perIpPerHour: 5,
  /** `AUDITS_DAILY_LIMIT` do `app-daily`. */
  dailyOfDailyApp: 3,
};
