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
  /** RF-RA029: `http_error` com 403 (pode ser login ou bloqueio de robô; não marca barreira de login). */
  forbidden: (status: number) =>
    `O site recusou o acesso (HTTP ${status}). Ele pode exigir login ou bloquear acessos automáticos.`,
  /** RF-RA028 e RF-RA029: `http_error` com 401 (início do aviso de barreira de login; o 403 tem mensagem própria). */
  loginWallStart: (status: number) => `Esta página pede login (HTTP ${status}).`,
};

/** Textos da interface que os critérios afirmam (a fonte é `frontend/src/i18n/pt-BR.ts`). */
export const screenTexts = {
  /** RF-RA028: aviso de barreira de login no relatório da página e no resumo. */
  loginWall: "Esta página pede login. O Rampa auditou a tela de entrada; áreas logadas ainda não são cobertas.",
  /** RF-RA005: aviso fixo do relatório. */
  disclaimer:
    "A verificação automática não garante conformidade e não substitui a avaliação com pessoas e tecnologias assistivas.",
  /** RF-RA005, RF-RA006 e RF-RA007: rótulo do selo de severidade, pelo nome da API. */
  severity: { critical: "Crítico", serious: "Sério", moderate: "Moderado", minor: "Menor" },
  /** RF-RA017: selo de cada regra da aba "Aprovados". */
  passed: "Aprovado",
  /** RF-RA029: botão da tela de falha e do relatório concluído. */
  auditAgain: "Auditar de novo",
  /** RF-RA002/RF-RA029: limite por hora, com o horário no fuso do navegador. */
  rateLimited: /^Você atingiu o limite de auditorias por hora\. Tente de novo a partir (das|de \d{2}\/\d{2}\/\d{4}, às) (\d{2}:\d{2})\.$/,
};
