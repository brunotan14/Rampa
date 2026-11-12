// design/components/SeverityBar: a proporção de problemas por severidade numa barra, com a
// legenda inteira em texto (selo, contagem e porcentagem). A barra é `aria-hidden`; os
// segmentos são separados por espaço, não só por cor, e o de revisão é listrado.
import { formatNumber } from "../i18n";
import type { Severity } from "../severity";
import { SeverityBadge } from "./SeverityBadge";

export interface SeverityBarItem {
  level: Exclude<Severity, "sucesso">;
  count: number;
}

export function SeverityBar({ items, label }: { items: readonly SeverityBarItem[]; label: string }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const pct = (count: number) => (total === 0 ? 0 : Math.round((count / total) * 100));
  return (
    <div className="rp-sevbar">
      <div className="rp-sevbar__track" aria-hidden="true">
        {items
          .filter((item) => item.count > 0)
          .map((item, i) => (
            <span
              key={item.level}
              className={`rp-sevbar__seg rp-sevbar__seg--${item.level}`}
              style={{ flexGrow: item.count, animationDelay: `calc(${i} * var(--duration-fast) * 0.75)` }}
            />
          ))}
      </div>
      <ul className="rp-sevbar__legend" aria-label={label}>
        {items.map((item) => (
          <li key={item.level}>
            <SeverityBadge level={item.level} count={item.count} />
            <span className="rp-sevbar__pct">{formatNumber(pct(item.count))}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
