import type { TestInfo } from "@playwright/test";

// Evidência e rastreabilidade dos casos: cada caso cita o critério de aceite que cobre (anotação
// `requisito`, com o texto do PRD) e anexa o que mediu, para o relatório mostrar o observado
// mesmo quando o caso passa.

const OBSERVED_PREFIX = "observado";

/** Anotação com o texto literal do critério (ou da regra) do PRD que o caso cobre. */
export function requirement(text: string): { type: string; description: string } {
  return { type: "requisito", description: text };
}

/**
 * Anexa os valores medidos (status, corpos, resumos) como JSON. Chamar antes das asserções,
 * para a evidência existir também quando o caso falha.
 */
export async function attachObserved(testInfo: TestInfo, observed: unknown, name = OBSERVED_PREFIX): Promise<void> {
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify(observed, null, 2),
    contentType: "application/json",
  });
}

/** Para o `afterEach`: reprova o caso que passou sem anexar nada com `attachObserved`. */
export function requireObserved(testInfo: TestInfo): void {
  if (testInfo.status !== "passed") return;
  const attached = testInfo.attachments.some((attachment) => attachment.name.startsWith(OBSERVED_PREFIX));
  if (!attached) {
    throw new Error(`"${testInfo.title}" passou sem anexar o observado (attachObserved).`);
  }
}
