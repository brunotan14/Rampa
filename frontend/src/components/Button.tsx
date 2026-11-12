// design/components/Button: dispara uma ação na mesma página (para navegar, use `Link`).
// Código de referência: design/05-implementacao.md, "1. Botão".
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Icon, type IconName } from "./Icon";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** `sm` 36px (tabelas densas), `md` 44px, `lg` 56px (tela inicial). */
  size?: "sm" | "md" | "lg";
  /** Continua focável e é anunciado como "indisponível" (`aria-disabled`); cliques ignorados. */
  disabled?: boolean;
  /** Spinner, `aria-busy` e cliques ignorados. */
  loading?: boolean;
  /** Rótulo enquanto carrega, ex.: "Auditando…". */
  loadingLabel?: string;
  iconStart?: IconName;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "primary",
  size = "md",
  disabled,
  loading,
  loadingLabel,
  iconStart,
  className,
  children,
  onClick,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  const blocked = Boolean(disabled || loading);
  const classes = ["rp-btn", `rp-btn--${variant}`, size !== "md" && `rp-btn--${size}`, className].filter(Boolean).join(" ");
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      onClick={(event) => {
        // aria-disabled não bloqueia sozinho (nem o envio de formulário)
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {loading ? <span className="rp-spinner" aria-hidden="true" /> : iconStart && <Icon name={iconStart} />}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}
