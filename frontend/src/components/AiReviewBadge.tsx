// design/components/AiReviewBadge: achado da IA (ou de heurística) é sugestão, não veredito.
// Borda tracejada, ícone de olho e o texto "Avaliado por IA, confirme manualmente", com a
// confiança em palavra e número ("Confiança alta (86%)"). As barras são decorativas.
import { formatNumber, t } from "../i18n";
import { confidenceBand } from "../report";
import { Icon } from "./Icon";

const BARS = { alta: 3, media: 2, baixa: 1 } as const;

export function AiReviewBadge({ confidence }: { confidence: number | null }) {
  const band = confidence === null ? null : confidenceBand(confidence);
  return (
    <span className="rp-ai">
      <Icon name="revisao" size="sm" />
      <span>{t.report.ai.label}</span>
      {band !== null && confidence !== null && (
        <span className="rp-ai__conf">
          <span className="rp-ai__bars" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={n <= BARS[band] ? "on" : undefined} />
            ))}
          </span>
          {`${t.report.ai.confidence[band]} (${formatNumber(Math.round(confidence * 100))}%)`}
        </span>
      )}
    </span>
  );
}
