// Detalhe de um problema (RF-RA007, parte do M2; design/components/TelaDetalheProblema), em
// `/auditorias/:id/problemas/:findingId`: severidade (cor + ícone + texto), critérios WCAG (só o
// número no M2), origem e, se for IA, confiança, justificativa e o selo "Avaliado por IA,
// confirme manualmente"; seletor, trecho de HTML, ocorrências e onde mais aparece. "Quem é
// afetado" e "Como corrigir" mostram o que a API entrega: no M2, a mensagem do axe (em inglês) e
// o link da documentação da regra; os textos em PT-BR chegam no M3.
// Fora no M2: eMAG, recorte de tela (M4), CodeDiff, Confirmar / Não é um problema / Marcar como
// corrigido (pós-MVP).
import { useParams } from "react-router";
import { useFinding, usePages } from "../api/hooks";
import type { FindingDetail } from "../api/types";
import { AxeText } from "../components/AxeText";
import { CodeBlock } from "../components/CodeBlock";
import { findingTitleText } from "../components/FindingTitle";
import { Link } from "../components/Link";
import { Reveal } from "../components/Reveal";
import { ReviewBadge } from "../components/ReviewBadge";
import { SeverityBadge } from "../components/SeverityBadge";
import { StatCard, StatGrid } from "../components/StatCard";
import { t } from "../i18n";
import { hostOf, isAuditId, pageName, pagePath, pagesPath } from "../report";
import { fromApiSeverity } from "../severity";
import { NotFoundPage } from "./NotFoundPage";
import { ReportScreen, reportCrumb, useLiveAudit } from "./reportParts";

export function FindingPage() {
  const { id, findingId } = useParams();
  if (!isAuditId(id) || !isAuditId(findingId)) return <NotFoundPage />;
  return <FindingView key={`${id}/${findingId}`} auditId={id} findingId={findingId} />;
}

function FindingView({ auditId, findingId }: { auditId: string; findingId: string }) {
  const { summary, refetchInterval } = useLiveAudit(auditId);
  const finding = useFinding(auditId, findingId, { refetchInterval });
  const host = hostOf(summary.data?.start_url);

  return (
    <ReportScreen
      query={finding}
      title={findingTitleText}
      lang={(data) => (data.help ? "en" : undefined)}
      loadingTitle={t.report.finding.loadingTitle}
      loadingText={t.report.finding.loading}
      notFound={{
        title: t.report.finding.notFoundTitle,
        state: t.report.finding.notFoundState,
        back: { href: pagesPath(auditId), label: t.report.page.backToPages },
      }}
      crumbs={(data) => [
        reportCrumb(auditId, host),
        { label: t.report.crumbs.pages, href: pagesPath(auditId) },
        { label: pageName(data.page), href: pagePath(auditId, data.page.id) },
        { label: t.report.crumbs.finding },
      ]}
      head={(data) => (
        <div className="rp-card__meta">
          <SeverityBadge level={fromApiSeverity(data.severity)} />
          <ReviewBadge finding={data} />
        </div>
      )}
    >
      {(data) => <FindingBody auditId={auditId} finding={data} />}
    </ReportScreen>
  );
}

function sourceText(finding: FindingDetail): string {
  switch (finding.source) {
    case "axe":
      return t.report.finding.sourceAxe(finding.axe_version, finding.rule_id);
    case "ai":
      return t.report.finding.sourceAi(finding.ai_model);
    default:
      return t.report.finding.sourceHeuristic;
  }
}

function FindingBody({ auditId, finding }: { auditId: string; finding: FindingDetail }) {
  // "Onde mais aparece" traz só a `url` pedida; o endereço exibido é o final, como no resto do
  // relatório, e vem da lista de páginas (a mesma do cache das outras telas).
  const pages = usePages(auditId);
  const finalUrl = new Map(pages.data?.data.map((p) => [p.id, p.final_url ?? p.url]));
  const ai = finding.source !== "axe";
  const times = t.report.finding.stats.times;
  return (
    <div className="rp-detail">
      <div className="rp-detail__main">
        <StatGrid>
          <StatCard label={t.report.finding.stats.page} value={finding.occurrences.page} suffix={times(finding.occurrences.page)} />
          <StatCard label={t.report.finding.stats.audit} value={finding.occurrences.audit} suffix={times(finding.occurrences.audit)} />
        </StatGrid>

        <Reveal as="section" className="rp-card__section" aria-labelledby="codigo-encontrado">
          <h2 id="codigo-encontrado" className="rp-h3">
            {t.report.finding.code}
          </h2>
          {finding.html_snippet ? <CodeBlock code={finding.html_snippet} /> : <p>{t.report.finding.noCode}</p>}
        </Reveal>

        {ai && (finding.ai_reason || finding.ai_suggestion) && (
          <Reveal as="section" className="rp-card__section" aria-labelledby="avaliacao-ia">
            <h2 id="avaliacao-ia" className="rp-h3">
              {t.report.finding.ai.title}
            </h2>
            <dl className="rp-card__dl">
              {finding.ai_reason && (
                <>
                  <dt>{t.report.finding.ai.reason}</dt>
                  <dd>{finding.ai_reason}</dd>
                </>
              )}
              {finding.ai_suggestion && (
                <>
                  <dt>{t.report.finding.ai.suggestion}</dt>
                  <dd>{finding.ai_suggestion}</dd>
                </>
              )}
            </dl>
          </Reveal>
        )}

        {finding.who_is_affected && (
          <Reveal as="section" className="rp-card__section" aria-labelledby="quem-e-afetado">
            <h2 id="quem-e-afetado" className="rp-h3">
              {t.report.finding.who}
            </h2>
            <p>{finding.who_is_affected}</p>
          </Reveal>
        )}

        <Reveal as="section" className="rp-card__section" aria-labelledby="como-corrigir">
          <h2 id="como-corrigir" className="rp-h3">
            {t.report.finding.fix}
          </h2>
          {finding.how_to_fix && <p>{finding.how_to_fix}</p>}
          {finding.source === "axe" && finding.message && (
            <>
              <p className="rp-caption">{t.report.finding.axeSays}</p>
              <p className="rp-axe-message">
                <AxeText>{finding.message}</AxeText>
              </p>
            </>
          )}
          {finding.help_url && (
            <p>
              <Link href={finding.help_url} external>
                {t.report.finding.docs(finding.rule_id)}
              </Link>
            </p>
          )}
        </Reveal>
      </div>

      <aside className="rp-detail__aside" aria-label={t.report.finding.aside}>
        <section className="rp-panel" aria-labelledby="detalhes">
          <h2 id="detalhes" className="rp-h3">
            {t.report.finding.details}
          </h2>
          <dl className="rp-card__dl rp-card__dl--stack">
            <dt>{t.report.finding.severity}</dt>
            <dd>
              <SeverityBadge level={fromApiSeverity(finding.severity)} />
            </dd>
            <dt>{t.report.finding.criteria}</dt>
            <dd>
              {finding.wcag_criteria.length > 0 ? finding.wcag_criteria.map(t.report.criterion).join(", ") : t.report.noCriteria}
            </dd>
            <dt>{t.report.finding.source}</dt>
            <dd>{sourceText(finding)}</dd>
            <dt>{t.report.finding.element}</dt>
            <dd>{finding.selector ? <code>{finding.selector}</code> : t.report.group.noSelector}</dd>
            <dt>{t.report.finding.page}</dt>
            <dd>
              <Link href={pagePath(auditId, finding.page.id)}>{pageName(finding.page)}</Link>
              <span className="rp-pages__path">{finding.page.final_url ?? finding.page.url}</span>
            </dd>
          </dl>
        </section>

        {finding.other_pages.length > 0 && (
          <section className="rp-panel" aria-labelledby="onde-mais">
            <h2 id="onde-mais" className="rp-h3">
              {t.report.finding.elsewhere}
            </h2>
            <ul className="rp-list-plain">
              {finding.other_pages.map((other) => (
                <li key={other.page_id}>
                  <Link href={pagePath(auditId, other.page_id)}>{pageName(other)}</Link>
                  <span className="rp-caption rp-block">
                    {finalUrl.get(other.page_id) ?? other.url} · {t.report.finding.elsewhereTimes(other.occurrences)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

