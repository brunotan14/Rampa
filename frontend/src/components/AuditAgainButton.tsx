// "Auditar de novo" (RF-RA029): cria uma NOVA auditoria com a mesma `start_url` e o mesmo
// `page_limit`, com chave de idempotência nova, e leva à tela de progresso. A auditoria antiga
// não muda (o link dela pode ter sido compartilhado). Recusa (429 com o horário de liberação,
// como na tela inicial) aparece em alerta logo abaixo, ligada ao botão; o foco fica no botão.
import { useId } from "react";
import { t } from "../i18n";
import { useStartAudit } from "../startAudit";
import { Button } from "./Button";
import { Icon } from "./Icon";

export interface AuditAgainButtonProps {
  startUrl: string;
  pageLimit: number;
  variant?: "primary" | "secondary";
}

export function AuditAgainButton({ startUrl, pageLimit, variant = "primary" }: AuditAgainButtonProps) {
  const { start, pending, failure } = useStartAudit();
  const errorId = useId();
  return (
    <div className="rp-again">
      <Button
        variant={variant}
        loading={pending}
        loadingLabel={t.report.againLoading}
        aria-describedby={failure ? errorId : undefined}
        onClick={() => start({ url: startUrl, page_limit: pageLimit })}
      >
        {t.report.again}
      </Button>
      {failure && (
        // `key`: um alerta novo a cada erro, anunciado mesmo com o mesmo texto.
        <p key={failure.key} id={errorId} role="alert" className="rp-again__error">
          <Icon name="critico" size="sm" />
          <span>{failure.error.message}</span>
        </p>
      )}
    </div>
  );
}
