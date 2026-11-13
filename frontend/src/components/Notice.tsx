// Aviso de tela: ícone e texto, nunca só cor (1.4.1). Não é região viva: está na tela ao abrir
// e é lido na ordem da página. Para um erro que acabou de acontecer, use `StateMessage`.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface NoticeProps {
  icon?: IconName;
  /** `atencao` destaca a borda (barreira de login); `info` é o padrão. */
  tone?: "info" | "atencao";
  children: ReactNode;
  className?: string;
}

export function Notice({ icon = "info", tone = "info", children, className }: NoticeProps) {
  return (
    <div className={["rp-notice", `rp-notice--${tone}`, className].filter(Boolean).join(" ")}>
      <Icon name={icon} />
      <div className="rp-notice__body">{children}</div>
    </div>
  );
}
