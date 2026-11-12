// design/components/StatCard: um número grande que conta até o valor, com rótulo. Fica dentro
// de `StatGrid` (um `<dl>`): o leitor de tela lê "Críticos, 3". A barra de cor à esquerda é
// só reforço; o rótulo e o ícone dizem o que é (1.4.1).
import type { ReactNode } from "react";
import { CountUp } from "./CountUp";
import { Icon, type IconName } from "./Icon";

export function StatGrid({ children }: { children: ReactNode }) {
  return <dl className="rp-stats">{children}</dl>;
}

export interface StatCardProps {
  label: string;
  value: number;
  /** Texto depois do número ("de 100"). */
  suffix?: string;
  icon?: IconName;
  tone?: "neutro" | "critico" | "serio" | "moderado" | "menor" | "revisao" | "sucesso";
}

export function StatCard({ label, value, suffix, icon, tone = "neutro" }: StatCardProps) {
  return (
    <div className={`rp-stat rp-stat--${tone}`}>
      <dt className="rp-stat__label">
        {icon && <Icon name={icon} className="rp-stat__icon" />}
        {label}
      </dt>
      <dd className="rp-stat__value">
        <CountUp value={value} />
        {suffix && <span className="rp-stat__suffix"> {suffix}</span>}
      </dd>
    </div>
  );
}
