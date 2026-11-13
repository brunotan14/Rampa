// Começar uma auditoria e ir para a tela de progresso: a tela inicial (RF-RA001) e o botão
// "Auditar de novo" (RF-RA029) fazem o mesmo caminho. A chave de idempotência é do
// `useCreateAudit`: nova a cada pedido novo, mantida depois de uma falha passageira.
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { getAudit, isApiError } from "./api/client";
import { useCreateAudit } from "./api/hooks";
import { queryKeys } from "./api/queryKeys";
import type { CreateAuditRequest } from "./api/types";
import { errorMessage, formatFrom, t } from "./i18n";

export interface StartAuditError {
  message: string;
  /** O problema é o endereço digitado (o campo da tela inicial fica `aria-invalid`). */
  invalid: boolean;
}

// Códigos em que o problema é o endereço digitado.
const URL_ERRORS = new Set(["invalid_body", "unsupported_scheme", "invalid_url", "blocked_address", "unresolvable"]);

/** Mensagem do erro da criação. O 429 diz o horário no fuso de quem usa (PRD §15). */
export function createAuditError(error: unknown, now: Date = new Date()): StartAuditError {
  if (!isApiError(error)) return { message: errorMessage("internal_error"), invalid: false };
  if (error.retryAfter !== null && error.code === "rate_limited") {
    return { message: t.urlField.rateLimited(formatFrom(error.retryAfter, now)), invalid: false };
  }
  if (error.retryAfter !== null && error.code === "daily_limit_reached") {
    return { message: t.urlField.dailyLimitReached(formatFrom(error.retryAfter, now)), invalid: false };
  }
  return { message: error.message, invalid: URL_ERRORS.has(error.code) };
}

/**
 * Cria a auditoria e, no sucesso, busca o resumo antes de trocar de tela (o h1 da tela de
 * progresso já nasce com o host; se a busca falhar, a tela busca sozinha). Cada erro ganha um
 * número novo (`key`), para o alerta ser remontado e anunciado de novo mesmo com o mesmo texto.
 */
export function useStartAudit() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useCreateAudit();
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<{ error: StartAuditError; key: number } | null>(null);
  const errorCount = useRef(0);

  function start(input: CreateAuditRequest) {
    setFailure(null);
    create.mutate(input, {
      onSuccess: async ({ id }) => {
        setOpening(true);
        await queryClient
          .fetchQuery({ queryKey: queryKeys.audit(id), queryFn: ({ signal }) => getAudit(id, { signal }) })
          .catch(() => undefined);
        void navigate(`/auditorias/${id}`);
      },
      onError: (error) => {
        errorCount.current += 1;
        setFailure({ error: createAuditError(error), key: errorCount.current });
      },
    });
  }

  return { start, pending: create.isPending || opening, failure };
}
