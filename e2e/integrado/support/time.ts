// Horários como a API os mostra nas mensagens: fuso de São Paulo, `HH:MM`, 24 h
// (RF-RA002: janela por hora e dia de São Paulo no teto diário).

const saoPauloClock = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `HH:MM` de São Paulo de um instante ISO 8601 (ex.: `retry_after`). */
export function saoPauloTime(iso: string): string {
  return saoPauloClock.format(new Date(iso));
}
