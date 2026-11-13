// Textos de `error.message` que os critérios de aceite afirmam (PRD §9; a fonte é
// `RampaWeb.ErrorMessages` no backend). Ficam aqui para uma mudança de texto quebrar um lugar só.

export const messages = {
  /** RF-RA001: esquema que não é `http` nem `https` (`unsupported_scheme`). */
  unsupportedScheme: "Só endereços web (http:// ou https://) podem ser auditados.",
  /**
   * RF-RA002: início de `blocked_address`. O critério cita só esta frase; a API acrescenta
   * uma explicação depois dela.
   */
  blockedAddressStart: "Este endereço não pode ser auditado",
  /** RF-RA002: limite por IP (`rate_limited`). O grupo 1 é o horário `HH:MM` de São Paulo. */
  rateLimited: /^Você atingiu o limite de auditorias por hora\. Tente de novo a partir das (\d{2}:\d{2})\.$/,
  /** RF-RA002: teto diário (`daily_limit_reached`). */
  dailyLimitReached: "O limite de auditorias de hoje acabou. Tente de novo amanhã.",
  /** RF-RA029: `http_error` com 404 ou 410. */
  notFound: (status: number) => `A página não foi encontrada (HTTP ${status}). Confira o endereço.`,
  /** RF-RA029: `http_error` com 500, 502, 503 ou 504 (site instável). */
  unstable: (status: number) =>
    `O site respondeu com um erro (HTTP ${status}) e pode estar instável. Tente de novo em alguns minutos.`,
  /** RF-RA028 e RF-RA029: `http_error` com 401 (início do aviso de barreira de login; o 403 tem mensagem própria). */
  loginWallStart: (status: number) => `Esta página pede login (HTTP ${status}).`,
};
