// design/components/Link: navega para outro endereço. Sublinhado no corpo do texto (1.4.1).
// Interno usa o roteador (sem recarregar a página); externo abre em nova aba e diz isso em texto.
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";
import { t } from "../i18n";
import { Icon } from "./Icon";

export interface LinkProps {
  /** Caminho interno (`/auditorias/...`) ou endereço externo (com `external`). */
  href: string;
  children: ReactNode;
  /** Abre em nova aba, com ícone e "(abre em nova aba)" para o leitor de tela. */
  external?: boolean;
  /** Isolado (fora de parágrafo): `body-strong` e alvo mínimo de 24px. */
  standalone?: boolean;
  className?: string;
  id?: string;
  /** Troca de tela com View Transitions, quando o navegador tem e o movimento é permitido. */
  viewTransition?: boolean;
}

export function Link({ href, children, external, standalone, className, id, viewTransition }: LinkProps) {
  const classes = ["rp-link", standalone && "rp-link--standalone", className].filter(Boolean).join(" ");
  if (external) {
    return (
      <a href={href} id={id} className={classes} target="_blank" rel="noopener noreferrer">
        {children}{" "}
        <Icon name="externo" size="sm" className="rp-link__icon" />
        <span className="rp-sr">{t.link.newTab}</span>
      </a>
    );
  }
  return (
    <RouterLink to={href} id={id} className={classes} viewTransition={viewTransition}>
      {children}
    </RouterLink>
  );
}
