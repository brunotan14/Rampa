// Relatório resumido (RF-RA005, design/components/TelaRelatorioResumo) da auditoria concluída,
// em `/auditorias/:id`. Mostra: o aviso fixo de que a verificação automática não garante
// conformidade, a barreira de login (RF-RA028), os totais por severidade separando os confirmados
// dos que pedem confirmação, os 5 problemas mais frequentes e "Auditar de novo" (RF-RA029).
// A pontuação (§10.6) é do M3: enquanto a API manda `score: null`, nada de número.
// Fora no M2: Exportar PDF, Compartilhar, variação desde a última auditoria, "Quem é impactado" e
// "Conformidade" (dependem do M3 e de contas).
import { useEffect, useId, useRef, type Ref } from "react";
import type { AuditSummary } from "../api/types";
import { AuditAgainButton } from "../components/AuditAgainButton";
import { FindingTitle } from "../components/FindingTitle";
import { Link } from "../components/Link";
import { Notice } from "../components/Notice";
import { Reveal } from "../components/Reveal";
import { ScoreIndicator } from "../components/ScoreIndicator";
import { SeverityBadge } from "../components/SeverityBadge";
import { SeverityBar } from "../components/SeverityBar";
import { StatCard, StatGrid } from "../components/StatCard";
import { StateMessage } from "../components/StateMessage";
import { formatAt, formatNumber, plural, t } from "../i18n";
import { findingPath, pagesPath } from "../report";
import { API_SEVERITIES, fromApiSeverity, severityTotals, totalProblems } from "../severity";
import { LoadErrorState, LoginWallNotice, ReportHead } from "./reportParts";

export interface AuditReportProps {
  auditId: string;
  host: string | null;
  summary: AuditSummary | undefined;
  /** Erro do `GET /api/audits/:id` (o canal disse que acabou, mas o resumo não veio). */
  error: unknown;
  fetching: boolean;
  refetch: () => void;
  titleRef?: Ref<HTMLHeadingElement>;
}

export function AuditReport({ auditId, host, summary, error, fetching, refetch, titleRef }: AuditReportProps) {
  const title = host ? t.report.summary.title(host) : t.report.summary.titleNoHost;
  // O canal pode ter visto o fim antes do resumo em cache (que ainda diz "na fila"): o resumo
  // concluído é buscado uma vez; até ele chegar, a tela diz que está carregando.
  const ready = summary !== undefined && summary.status === "completed";
  const asked = useRef(false);
  useEffect(() => {
    if (ready || fetching || asked.current || summary === undefined) return;
    asked.current = true;
    refetch();
  }, [ready, fetching, summary, refetch]);

  const finished = summary ? new Date(summary.finished_at ?? summary.inserted_at) : null;
  return (
    <>
      <ReportHead title={title} titleRef={titleRef}>
        {ready && finished && !Number.isNaN(finished.getTime()) ? (
          <p className="rp-caption">
            {t.report.summary.meta(
              formatAt(finished),
              plural(summary.pages_scanned, "página analisada", "páginas analisadas"),
            )}
          </p>
        ) : null}
        {ready ? (
          <div className="rp-actions">
            <AuditAgainButton startUrl={summary.start_url} pageLimit={summary.page_limit} variant="secondary" />
            <Link href={pagesPath(auditId)} standalone>
              {t.report.summary.viewPages}
            </Link>
          </div>
        ) : null}
      </ReportHead>
      {ready ? (
        <ReportBody auditId={auditId} summary={summary} />
      ) : error && !fetching ? (
        <LoadErrorState error={error} title={t.audit.loadErrorTitle} onRetry={refetch} />
      ) : (
        <StateMessage kind="carregando" title={t.report.summary.loading} />
      )}
    </>
  );
}

function ReportBody({ auditId, summary }: { auditId: string; summary: AuditSummary }) {
  const problems = totalProblems(summary.totals_by_severity);
  const review = summary.needs_review_count;
  return (
    <div className="rp-report">
      {summary.login_wall_pages > 0 && <LoginWallNotice pages={summary.login_wall_pages} />}
      <Notice>
        <p>{t.report.disclaimer}</p>
      </Notice>

      <StatGrid>
        <StatCard label={t.report.summary.stats.problems} value={problems} icon="pagina" />
        <StatCard
          label={t.report.summary.stats.critical}
          value={summary.totals_by_severity.critical}
          icon="critico"
          tone="critico"
        />
        <StatCard label={t.report.summary.stats.review} value={review} icon="revisao" tone="revisao" />
        <StatCard label={t.report.summary.stats.pages} value={summary.pages_scanned} icon="busca" />
        {summary.pages_failed > 0 && (
          <StatCard label={t.report.summary.stats.failed} value={summary.pages_failed} icon="serio" tone="serio" />
        )}
      </StatGrid>

      {summary.score !== null && (
        <div className="rp-panel">
          <ScoreIndicator value={summary.score} description={t.report.summary.scoreText} />
        </div>
      )}

      <SeverityTable summary={summary} />
      <TopIssues auditId={auditId} summary={summary} />

      {review > 0 && (
        <Reveal as="section" className="rp-section" aria-labelledby="achados-para-confirmar">
          <h2 id="achados-para-confirmar" className="rp-h2">
            {t.report.summary.review.title}
          </h2>
          <div className="rp-panel">
            <div>
              <SeverityBadge level="revisao" count={review} />
            </div>
            <p>{t.report.summary.review.text(review)}</p>
            <Link href={pagesPath(auditId, "?revisao=sim")} standalone>
              {t.report.summary.review.link}
            </Link>
          </div>
        </Reveal>
      )}
    </div>
  );
}

function SeverityTable({ summary }: { summary: AuditSummary }) {
  const captionId = useId();
  const auto = summary.totals_by_severity;
  const review = summary.needs_review_by_severity;
  const items = [
    ...severityTotals(auto).map(({ severity, count }) => ({ level: severity, count })),
    { level: "revisao" as const, count: summary.needs_review_count },
  ];
  return (
    <Reveal as="section" className="rp-section" aria-labelledby="por-severidade">
      <h2 id="por-severidade" className="rp-h2">
        {t.report.summary.severity.title}
      </h2>
      <SeverityBar items={items} label={t.report.summary.severity.barLabel} />
      {/* Contêiner rolável com foco pelo teclado (design/components/DataTable, 1.4.10 e 2.1.1): em
          320px ou com zoom a tabela rola dentro dele, sem empurrar a tela. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- região rolável precisa de foco pelo teclado */}
      <div className="rp-table-wrap" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table className="rp-table">
          <caption id={captionId}>{t.report.summary.severity.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.report.summary.severity.severity}</th>
              <th scope="col" className="num">
                {t.report.summary.severity.auto}
              </th>
              <th scope="col" className="num">
                {t.report.summary.severity.review}
              </th>
            </tr>
          </thead>
          <tbody>
            {API_SEVERITIES.map((severity) => (
              <tr key={severity}>
                <th scope="row">
                  <SeverityBadge level={fromApiSeverity(severity)} />
                </th>
                <td className="num">{formatNumber(auto[severity])}</td>
                <td className="num">{formatNumber(review[severity])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t.report.summary.severity.total}</th>
              <td className="num">{formatNumber(totalProblems(auto))}</td>
              <td className="num">{formatNumber(summary.needs_review_count)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Reveal>
  );
}

function TopIssues({ auditId, summary }: { auditId: string; summary: AuditSummary }) {
  const top = summary.top_issues;
  return (
    <Reveal as="section" className="rp-section" aria-labelledby="mais-frequentes">
      <h2 id="mais-frequentes" className="rp-h2">
        {t.report.summary.top.title}
      </h2>
      {top.length === 0 ? (
        <StateMessage
          kind="vazio"
          icon="info"
          headingLevel={3}
          title={t.report.summary.top.emptyTitle}
          text={t.report.summary.top.emptyText}
        />
      ) : (
        <>
          <p className="rp-caption">{t.report.summary.top.note}</p>
          <ol className="rp-top">
            {top.map((issue, index) => (
              <Reveal as="li" step={index} key={`${issue.rule_id}:${issue.sample_finding_id}`} className="rp-panel rp-panel--lift">
                <div className="rp-card__meta">
                  <SeverityBadge level={fromApiSeverity(issue.severity)} />
                </div>
                <h3 className="rp-h3 rp-top__title">
                  <span className="rp-sr">{t.report.summary.top.rank(index + 1)}</span>
                  <FindingTitle finding={issue} />
                </h3>
                <p className="rp-caption">
                  {[
                    t.report.summary.top.pages(issue.pages_affected),
                    t.report.summary.top.occurrences(issue.occurrences),
                    issue.wcag_criteria.map(t.report.criterion).join(", ") || t.report.noCriteria,
                  ].join(" · ")}
                </p>
                <Link href={findingPath(auditId, issue.sample_finding_id)} standalone>
                  {t.report.summary.top.details}{" "}
                  <span className="rp-sr">
                    {t.report.summary.top.detailsOf} <FindingTitle finding={issue} />
                  </span>
                </Link>
              </Reveal>
            ))}
          </ol>
          <Link href={pagesPath(auditId)} standalone>
            {t.report.summary.top.all}
          </Link>
        </>
      )}
    </Reveal>
  );
}
