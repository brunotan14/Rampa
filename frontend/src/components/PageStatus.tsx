// Status de uma página da auditoria com ícone e texto (cor nunca sozinha). Os ícones são os do
// feed da tela de progresso: analisada (check), com falha (triângulo), na fila ou em análise
// (relógio). "Analisada" diz que a varredura terminou, não que a página passou.
import type { PageSummary } from "../api/types";
import { t } from "../i18n";
import { Icon, type IconName } from "./Icon";

const ICON: Record<PageSummary["status"], IconName> = {
  queued: "relogio",
  scanning: "relogio",
  analyzing: "relogio",
  done: "sucesso",
  failed: "serio",
};

export function PageStatus({ status }: { status: PageSummary["status"] }) {
  return (
    <span className={`rp-pstatus rp-pstatus--${status}`}>
      <Icon name={ICON[status]} size="sm" />
      {t.report.pageStatus[status]}
    </span>
  );
}
