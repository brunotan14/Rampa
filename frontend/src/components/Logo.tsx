// design/components/Logo: a marca em SVG, com as cores dos tokens (acompanha o tema, inclusive
// o alto contraste). O R está na grade do ladrilho e a perna dele é a rampa.
import { useId } from "react";
import { t } from "../i18n";

const R_STEM = "M0 8h8v40h-8z";
const R_BOWL = "M8 8h10a12 12 0 0 1 0 24h-10v-8h10a4 4 0 0 0 0-8h-10z";
const R_LEG = "M11 32h9l12 16h-9z";
const WORD = [
  "M53 20a14 14 0 1 0 0.01 0zM53 28a6 6 0 1 1 -0.01 0z",
  "M59 20h8v28h-8z",
  "M74 20h8v28h-8z M94 34h8v14h-8z M114 34h8v14h-8z",
  "M74 34A14 14 0 0 1 102 34H94A6 6 0 0 0 82 34Z",
  "M94 34A14 14 0 0 1 122 34H114A6 6 0 0 0 102 34Z",
  "M129 20h8v40h-8z",
  "M147 20a14 14 0 1 1 -0.01 0zM147 28a6 6 0 1 0 0.01 0z",
  "M182 20a14 14 0 1 0 0.01 0zM182 28a6 6 0 1 1 -0.01 0z",
  "M188 20h8v28h-8z",
];

export interface LogoProps {
  variant?: "assinatura" | "simbolo";
  /** Altura em px (padrão 32; a assinatura pede pelo menos 28). A largura acompanha. */
  height?: number;
  /** Nome acessível. Dentro do link para a home: "Rampa, página inicial". */
  title?: string;
  className?: string;
}

export function Logo({ variant = "assinatura", height = 32, title = t.app.name, className }: LogoProps) {
  const titleId = useId();
  const symbolOnly = variant === "simbolo";
  const viewWidth = symbolOnly ? 64 : 280;
  return (
    <svg
      className={["rp-logo", className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${viewWidth} 72`}
      height={height}
      width={Math.round((height * viewWidth) / 72)}
      role="img"
      aria-labelledby={titleId}
      focusable="false"
    >
      <title id={titleId}>{title}</title>
      <rect className="rp-logo__tile" width="64" height="64" rx="8" />
      <g transform="translate(16 4)">
        <path className="rp-logo__fg" d={R_STEM} />
        <path className="rp-logo__fg" d={R_BOWL} />
        <path className="rp-logo__ramp" d={R_LEG} />
      </g>
      {!symbolOnly && (
        <g transform="translate(84 8)">
          <path className="rp-logo__ink" d={R_STEM} />
          <path className="rp-logo__ink" d={R_BOWL} />
          <path className="rp-logo__accent" d={R_LEG} />
          {WORD.map((d) => (
            <path key={d} className="rp-logo__ink" d={d} fillRule="evenodd" />
          ))}
        </g>
      )}
    </svg>
  );
}
