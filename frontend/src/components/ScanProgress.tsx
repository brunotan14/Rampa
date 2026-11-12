// design/components/ScanProgress: a varredura ao vivo sem inundar o leitor de tela. A barra e
// os contadores mudam a cada lote do canal (500 ms), mas não são regiões vivas. A ÚNICA região
// viva da tela é a deste componente, montada vazia desde o início, e fala só:
//   - nos marcos de 25% (no máximo uma vez a cada 10 s), enquanto a varredura anda;
//   - no fim, com o `announcement` de `useAuditChannel` (uma vez só; a conclusão vence o marco).
// Código de referência: design/05-implementacao.md, "3. Progresso da varredura".
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { CountUp } from "./CountUp";
import { Icon } from "./Icon";

export type ScanStatus = "queued" | "discovering" | "running" | "done" | "failed" | "cancelled";

export const ANNOUNCE_EVERY = 25;
export const ANNOUNCE_MIN_GAP_MS = 10_000;

export interface ScanProgressProps {
  /** Endereço auditado, em fonte mono; `null` enquanto não se sabe. */
  url: string | null;
  status: ScanStatus;
  found: number;
  scanned: number;
  failed: number;
  /** Motivo da parada (`progress.error.message`). */
  errorMessage?: string | null;
  /** Texto final para a região viva (o `announcement` do canal). */
  announcement: string | null;
  /** Linha de estado da conexão, ao lado do título. */
  connection?: ReactNode;
  actions?: ReactNode;
  announceEvery?: number;
  minGapMs?: number;
}

export function progressPercent(found: number, finished: number): number {
  if (found <= 0) return 0;
  return Math.min(100, Math.round((finished / found) * 100));
}

export function ScanProgress({
  url,
  status,
  found,
  scanned,
  failed,
  errorMessage,
  announcement,
  connection,
  actions,
  announceEvery = ANNOUNCE_EVERY,
  minGapMs = ANNOUNCE_MIN_GAP_MS,
}: ScanProgressProps) {
  const titleId = useId();
  const finished = scanned + failed;
  const pct = progressPercent(found, finished);
  const indeterminate = status === "discovering";
  const running = status === "running";

  // Marco já atingido quando a tela abriu: não é anunciado (só os que vierem depois).
  const last = useRef({ step: Math.floor(pct / announceEvery), at: 0 });
  const [milestone, setMilestone] = useState("");

  useEffect(() => {
    if (!running) return;
    const step = Math.floor(pct / announceEvery);
    const now = Date.now();
    // 100% não é marco: o fim é anunciado pela conclusão.
    if (step > last.current.step && pct < 100 && now - last.current.at >= minGapMs) {
      last.current = { step, at: now };
      setMilestone(t.audit.scan.milestone(pct, scanned, found));
    }
  }, [pct, running, announceEvery, minGapMs, scanned, found]);

  const progressText = indeterminate
    ? t.audit.scan.progressIndeterminate
    : t.audit.scan.progressValue(pct, finished, found);

  return (
    <section className={`rp-scan rp-scan--${status}`} aria-labelledby={titleId}>
      <div className="rp-scan__head">
        <h2 id={titleId} className="rp-scan__title">
          {t.audit.scan.title[status]}
        </h2>
        {connection}
      </div>
      {url !== null && <p className="rp-scan__url">{url}</p>}

      <div
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuetext={progressText}
        className="rp-progress__track"
      >
        <div
          className={`rp-progress__fill${indeterminate ? " rp-progress__fill--indet" : ""}`}
          style={indeterminate ? undefined : { inlineSize: `${pct}%` }}
        />
      </div>
      <p className="rp-scan__pct" aria-hidden="true">
        {indeterminate ? "" : <CountUp value={pct} />}
        {indeterminate ? "" : "%"}
      </p>

      <dl className="rp-scan__stats">
        <div>
          <dt>
            <Icon name="pagina" size="sm" />
            {t.audit.scan.found}
          </dt>
          <dd>
            <CountUp value={found} />
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="sucesso" size="sm" />
            {t.audit.scan.scanned}
          </dt>
          <dd>
            <CountUp value={scanned} />
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="serio" size="sm" />
            {t.audit.scan.failed}
          </dt>
          <dd>
            <CountUp value={failed} />
          </dd>
        </div>
      </dl>

      {status === "failed" && (
        // Sem `role="alert"`: a parada é anunciada uma vez, pela região viva abaixo.
        <div className="rp-scan__error">
          <Icon name="critico" />
          <p>
            <span className="rp-sr">{t.state.errorPrefix}</span>{" "}
            {errorMessage ?? t.audit.scan.failedFallback}
          </p>
        </div>
      )}

      {/* Única região viva da tela, sempre montada (vazia no início). */}
      <div className="rp-sr" role="status" aria-live="polite" aria-atomic="true">
        {announcement ?? milestone}
      </div>

      <div className="rp-scan__foot">
        {(status === "queued" || status === "discovering" || running) && (
          <p className="rp-scan__hint">{t.audit.scan.leaveHint}</p>
        )}
        {actions}
      </div>
    </section>
  );
}
