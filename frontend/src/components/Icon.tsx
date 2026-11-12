// design/components/Icon: SVG 24×24, traço de 2px em `currentColor`. Os seis ícones de estado
// têm formas diferentes (octógono, triângulo, losango, círculo, check, olho), para serem
// reconhecidos sem cor e no alto contraste (1.4.1).
import type { ReactElement } from "react";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;
const mark = { stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" } as const;

const SHAPES = {
  critico: (
    <>
      <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" {...stroke} strokeLinejoin="round" />
      <path d="M12 7v6" {...mark} />
      <circle cx="12" cy="16.5" r="1.4" fill="currentColor" />
    </>
  ),
  serio: (
    <>
      <path d="M12 3 22 20H2z" {...stroke} strokeLinejoin="round" />
      <path d="M12 9v5" {...mark} />
      <circle cx="12" cy="17" r="1.3" fill="currentColor" />
    </>
  ),
  moderado: (
    <>
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" {...stroke} strokeLinejoin="round" />
      <path d="M8 12h8" {...mark} />
    </>
  ),
  menor: (
    <>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="M12 11v5" {...mark} />
      <circle cx="12" cy="7.8" r="1.3" fill="currentColor" />
    </>
  ),
  sucesso: (
    <>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="m7.5 12.5 3 3 6-6.5" {...stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  revisao: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" {...stroke} strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" {...stroke} />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="M12 11v5" {...mark} />
      <circle cx="12" cy="7.8" r="1.3" fill="currentColor" />
    </>
  ),
  externo: (
    <path
      d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
      {...stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  pagina: (
    <>
      <path d="M6 3h8l4 4v14H6z" {...stroke} strokeLinejoin="round" />
      <path d="M14 3v4h4" {...stroke} />
    </>
  ),
  busca: (
    <>
      <circle cx="11" cy="11" r="6.5" {...stroke} />
      <path d="m16 16 4.5 4.5" {...stroke} strokeLinecap="round" />
    </>
  ),
  bloqueio: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" {...stroke} />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...stroke} />
    </>
  ),
  relogio: (
    <>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="M12 7v5l3 2" {...stroke} strokeLinecap="round" />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof SHAPES;

export interface IconProps {
  name: IconName;
  /** `sm` = 16px (`icon-sm`); padrão 20px (`icon-md`). */
  size?: "sm" | "md";
  /** Com rótulo, o ícone é informativo (`role="img"`); sem, é decorativo (`aria-hidden`). */
  label?: string;
  className?: string;
}

export function Icon({ name, size = "md", label, className }: IconProps) {
  const classes = ["rp-icon", size === "sm" && "rp-icon--sm", className].filter(Boolean).join(" ");
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <svg viewBox="0 0 24 24" className={classes} focusable="false" {...a11y}>
      {SHAPES[name]}
    </svg>
  );
}
