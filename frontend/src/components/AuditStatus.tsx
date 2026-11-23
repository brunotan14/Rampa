// Status de uma auditoria com ícone e texto (cor nunca sozinha), no padrão do `PageStatus`:
// na fila ou em andamento (relógio), concluída (check), interrompida (triângulo), cancelada
// (círculo i). "Concluída" diz que a auditoria terminou, não que o site passou.
import type { AuditStatus as Status } from "../api/types";
import { t } from "../i18n";
import { Icon, type IconName } from "./Icon";

const ICON: Record<Status, IconName> = {
  queued: "relogio",
  running: "relogio",
  completed: "sucesso",
  failed: "serio",
  cancelled: "info",
};

export function AuditStatus({ status }: { status: Status }) {
  return (
    <span className={`rp-pstatus rp-pstatus--${status}`}>
      <Icon name={ICON[status]} size="sm" />
      {t.auditStatus[status]}
    </span>
  );
}
