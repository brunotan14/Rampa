// design/components/ScanSteps: as etapas da auditoria, com a atual destacada. `<ol>` com nome;
// cada etapa diz o estado em texto oculto ("concluída", "em andamento", "pendente",
// "interrompida"), e a atual leva `aria-current="step"`. A troca de etapa não é anunciada
// sozinha: quem fala é a região viva do `ScanProgress`.
import { formatNumber, t } from "../i18n";
import { Icon } from "./Icon";

export interface ScanStepsProps {
  label: string;
  steps: readonly string[];
  /** Índice da etapa atual; `steps.length` = todas concluídas. */
  current: number;
  /** A etapa atual parou (auditoria com falha ou cancelada). */
  stopped?: boolean;
}

type StepState = "done" | "current" | "pending" | "stopped";

export function ScanSteps({ label, steps, current, stopped }: ScanStepsProps) {
  return (
    <ol className="rp-steps" aria-label={label}>
      {steps.map((step, index) => {
        const state: StepState =
          index < current ? "done" : index === current ? (stopped ? "stopped" : "current") : "pending";
        return (
          <li
            key={step}
            className={`rp-steps__item rp-steps__item--${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="rp-steps__dot" aria-hidden="true">
              {state === "done" ? (
                <Icon name="sucesso" size="sm" />
              ) : state === "stopped" ? (
                <Icon name="critico" size="sm" />
              ) : (
                formatNumber(index + 1)
              )}
            </span>
            <span>
              {step}
              <span className="rp-sr">, {t.audit.steps.state[state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
