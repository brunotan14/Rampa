// Leitura defensiva de JSON vindo da rede (API e canal).
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
