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
 * Cria a auditoria com `Idempotency-Key`. Pedir de novo a mesma URL depois de uma falha usa a
 * mesma chave: se o primeiro pedido chegou ao servidor e só a resposta se perdeu, volta o mesmo
 * `id` em vez de uma segunda auditoria. Depois do sucesso, ou com outra URL, a chave é nova.
 * Queda de rede é repetida uma vez sozinha, com a mesma chave.
 */
export function useCreateAudit() {
  const pending = useRef<{ url: string; key: string } | null>(null);

  function keyFor(url: string): string {
    if (pending.current?.url !== url) pending.current = { url, key: randomKey() };
    return pending.current.key;
  }

  return useMutation({
    mutationFn: (input: CreateAuditRequest) => createAudit(input, keyFor(input.url)),
    retry: (failureCount, error) => failureCount < 1 && isApiError(error) && error.code === "network_error",
    onSuccess: () => {
      pending.current = null;
    },
  });
}
