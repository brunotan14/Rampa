// design/components/SeverityBadge: severidade com três sinais ao mesmo tempo, forma do ícone,
// cor e palavra (1.4.1). Não é interativo; o leitor de tela lê "Sério" ou "3 críticos".
import { formatNumber } from "../i18n";
import { severityCountWord, severityIcon, severityLabel, type Severity } from "../severity";
import { Icon } from "./Icon";

export interface SeverityBadgeProps {
  level: Severity;
  /** Com contagem, o selo diz "3 críticos", "1 sério". */
  count?: number;
  /** Sobrescreve o rótulo (e a contagem). */
  label?: string;
}

export function SeverityBadge({ level, count, label }: SeverityBadgeProps) {
  const withCount = count !== undefined && label === undefined;
  return (
    <span className={`rp-badge rp-badge--${level}`}>
      <Icon name={severityIcon(level)} size="sm" className="rp-badge__icon" />
      {withCount && (
        <>
          <span className="rp-badge__count">{formatNumber(count)}</span>{" "}
        </>
      )}
      <span className="rp-badge__label">
        {label ?? (withCount ? severityCountWord(level, count) : severityLabel(level))}
      </span>
    </span>
  );
}
