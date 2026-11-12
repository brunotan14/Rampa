// design/components/ScoreIndicator: a pontuação como número, faixa em palavras e uma frase de
// contexto. O anel é decorativo (`aria-hidden`): toda a informação está no texto. A cor do arco
// não muda com a faixa (sem semáforo). Sempre com o rótulo do PRD §10.6.
import { formatNumber, t } from "../i18n";

export type ScoreBand = keyof typeof t.score.bands;

export function scoreBand(value: number): ScoreBand {
  if (value >= 90) return "excelente";
  if (value >= 75) return "bom";
  if (value >= 50) return "atencao";
  return "graves";
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreIndicator({ value, description }: { value: number; description: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const arc = (clamped / 100) * CIRCUMFERENCE;
  return (
    <figure className="rp-score">
      <svg className="rp-score__ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle className="rp-score__border" cx="60" cy="60" r="59" />
        <circle className="rp-score__track" cx="60" cy="60" r={RADIUS} />
        <circle
          className="rp-score__value"
          cx="60"
          cy="60"
          r={RADIUS}
          strokeDasharray={`${arc} ${CIRCUMFERENCE}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <figcaption className="rp-score__caption">
        <span className="rp-score__label">{t.score.label}</span>
        <span className="rp-score__num">
          {formatNumber(clamped)} <small>{t.score.outOf}</small>
        </span>
        <span className="rp-score__band">{t.score.bands[scoreBand(clamped)]}</span>
        <span className="rp-score__text">{description}</span>
      </figcaption>
    </figure>
  );
}
