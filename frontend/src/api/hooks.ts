// Hooks finos sobre o cliente da API, um por endpoint do relatório (PRD §9).
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { createAudit, getAudit, getFinding, getPage, isApiError, listFindings, listPages } from "./client";
import { queryKeys } from "./queryKeys";
import type { CreateAuditRequest, FindingsFilters } from "./types";

export function useAudit(auditId: string) {
  return useQuery({
    queryKey: queryKeys.audit(auditId),
    queryFn: ({ signal }) => getAudit(auditId, { signal }),
  });
}

export function usePages(auditId: string) {
  return useQuery({
    queryKey: queryKeys.pages(auditId),
    queryFn: ({ signal }) => listPages(auditId, { signal }),
  });
}

export function usePage(auditId: string, pageId: string) {
  return useQuery({
    queryKey: queryKeys.page(auditId, pageId),
    queryFn: ({ signal }) => getPage(auditId, pageId, { signal }),
  });
}

/** Achados com paginação por cursor: `fetchNextPage` segue o `next_cursor` (`null` = fim). */
export function useFindings(auditId: string, filters: FindingsFilters = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.findings(auditId, filters),
    queryFn: ({ signal, pageParam }) => listFindings(auditId, filters, pageParam, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useFinding(auditId: string, findingId: string) {
  return useQuery({
    queryKey: queryKeys.finding(auditId, findingId),
    queryFn: ({ signal }) => getFinding(auditId, findingId, { signal }),
  });
}

function randomKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Forma do pedido usada só para decidir a `Idempotency-Key`: sem espaços nas pontas, com
 * `https://` quando falta o esquema, host em minúsculas e sem o fragmento (o servidor
 * normaliza de verdade, RF-RA001). Endereço que o `URL` não entende fica como foi digitado.
 */
export function idempotencyScope(input: CreateAuditRequest): string {
  const raw = input.url.trim();
  let url = raw;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    parsed.hash = "";
    url = parsed.href;
  } catch {
    // fica o texto digitado
  }
  return `${url} ${input.page_limit ?? ""}`;
}

// Erro definitivo: repetir o mesmo pedido dá a mesma resposta (URL recusada, corpo inválido).
// O 429 passa com o tempo e o 409 é a corrida da mesma chave: nos dois, a chave continua.
function isDefinitive(error: unknown): boolean {
  return isApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 409;
}

/**
 * Cria a auditoria com `Idempotency-Key`, uma por pedido (`url` normalizada e `page_limit`).
 * Repetir o mesmo pedido depois de uma falha passageira (rede, 5xx, 429) usa a mesma chave:
 * se o primeiro chegou ao servidor e só a resposta se perdeu, volta o mesmo `id` em vez de uma
 * segunda auditoria. Depois do sucesso ou de um erro definitivo (4xx), a chave é nova.
 * Queda de rede é repetida uma vez sozinha, com a mesma chave.
 */
export function useCreateAudit() {
  const pending = useRef<{ scope: string; key: string } | null>(null);

  function keyFor(input: CreateAuditRequest): string {
    const scope = idempotencyScope(input);
    if (pending.current?.scope !== scope) pending.current = { scope, key: randomKey() };
    return pending.current.key;
  }

  return useMutation({
    mutationFn: (input: CreateAuditRequest) => createAudit(input, keyFor(input)),
    retry: (failureCount, error) => failureCount < 1 && isApiError(error) && error.code === "network_error",
    onSuccess: () => {
      pending.current = null;
    },
    onError: (error) => {
      if (isDefinitive(error)) pending.current = null;
    },
  });
}
