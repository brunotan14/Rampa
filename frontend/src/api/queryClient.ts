// Configuração do TanStack Query para os dados da API.
import { QueryClient } from "@tanstack/react-query";
import { ApiError, isApiError } from "./client";

const MAX_RETRIES = 2;
// Acima disso não vale segurar a tela esperando: o erro aparece com a mensagem da API, que
// diz a partir de quando tentar de novo.
const MAX_RETRY_AFTER_MS = 30_000;

function retryAfterMs(error: ApiError): number | null {
  return error.retryAfter === null ? null : Math.max(0, error.retryAfter.getTime() - Date.now());
}

/**
 * Tenta de novo só o que pode passar sozinho: queda de rede, erro do servidor (5xx) e 429
 * com `retry_after` curto. Erros 4xx (404 da auditoria, filtro inválido) aparecem na hora.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || !isApiError(error)) return false;
  if (error.status === 429) {
    const wait = retryAfterMs(error);
    return wait !== null && wait <= MAX_RETRY_AFTER_MS;
  }
  return error.status === 0 || error.status >= 500;
}

/** Espera o `retry_after` do 429; nos outros casos, 1 s, 2 s, 4 s... até 8 s. */
export function retryDelay(failureCount: number, error: unknown): number {
  if (isApiError(error)) {
    const wait = retryAfterMs(error);
    if (wait !== null) return wait;
  }
  return Math.min(1000 * 2 ** failureCount, 8000);
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay,
        // O relatório muda pelo canal (`useAuditChannel`), não por foco de janela: conteúdo
        // que troca sozinho ao voltar para a aba desorienta quem usa leitor de tela.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}
