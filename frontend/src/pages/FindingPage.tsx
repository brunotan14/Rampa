// Detalhe de um problema (RF-RA007; design/components/TelaDetalheProblema), em
// `/auditorias/:id/problemas/:findingId`: severidade (cor + ícone + texto), critérios WCAG com
// número e título, origem e, se for IA, confiança, justificativa e o selo "Avaliado por IA,
// confirme manualmente"; seletor, trecho de HTML, ocorrências e onde mais aparece. "Quem é
// afetado" segue o FR-008 (texto do achado; senão, o de cada critério). "Critérios relacionados"
// traz nível, resumo, link da W3C em português e as recomendações do eMAG que citam cada
// critério (M3). "Como corrigir" ainda mostra a mensagem do axe (em inglês) e o link da regra.
// Fora: recorte de tela (M4), CodeDiff, Confirmar / Não é um problema / Marcar como corrigido
// (pós-MVP).
//
// FR-017: o corpo só é montado com o achado e o catálogo dos critérios (que chegou, falhou ou
// passou de `CATALOG_WAIT_MS`). Depois de montado, nenhuma seção entra nem sai por causa do
// catálogo: quem já está lendo não vê o texto mudar de lugar. Só os rótulos curtos dos critérios
// trocam sozinhos se o catálogo chegar depois. Catálogo com falha: a tela fica como no M2.
import { Fragment, useEffect, useState } from "react";
import { useParams } from "react-router";
import { useFinding, usePages, useWcagCriteria } from "../api/hooks";
import type { FindingDetail, WcagCriterion } from "../api/types";
import { AxeText } from "../components/AxeText";
import { CodeBlock } from "../components/CodeBlock";
import { findingTitleText } from "../components/FindingTitle";
import { Link } from "../components/Link";
import { Reveal } from "../components/Reveal";
import { ReviewBadge } from "../components/ReviewBadge";
import { SeverityBadge } from "../components/SeverityBadge";
import { StatCard, StatGrid } from "../components/StatCard";
import {
  compareNumbering,
  criteriaFor,
  criteriaText,
  criterionShortLabel,
  isHttpsUrl,
  whoIsAffected,
  type CriteriaCatalog,
} from "../criteria";
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

/** Quanto o corpo espera o catálogo dos critérios antes de aparecer sem ele (FR-017). */
export const CATALOG_WAIT_MS = 1500;

/**
 * Catálogo para o corpo do detalhe: `body` fica `null` até o achado e o catálogo (que chegou,
 * falhou ou passou de `CATALOG_WAIT_MS`) estarem decididos, e daí em diante guarda o catálogo
 * daquele momento (ou `null`, sem ele). `live` é o catálogo de agora, para os rótulos curtos.
 */
function useCatalogForBody(findingReady: boolean) {
  const catalog = useWcagCriteria();
  const [waited, setWaited] = useState(false);
  const settled = catalog.isSuccess || catalog.isError || waited;
  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => setWaited(true), CATALOG_WAIT_MS);
    return () => clearTimeout(timer);
  }, [settled]);
  const [body, setBody] = useState<{ catalog: CriteriaCatalog | null } | null>(null);
  // Estado derivado na renderização (padrão do React): fixa o catálogo uma vez, ao montar o corpo.
  if (body === null && findingReady && settled) setBody({ catalog: catalog.data ?? null });
  return { body, live: catalog.data ?? null };
}

function FindingView({ auditId, findingId }: { auditId: string; findingId: string }) {
  const { summary, refetchInterval } = useLiveAudit(auditId);
  const finding = useFinding(auditId, findingId, { refetchInterval });
  const { body, live } = useCatalogForBody(finding.data !== undefined);
  const host = hostOf(summary.data?.start_url);
  // Com o achado na mão e o catálogo ainda sem decisão, a tela segue em "carregando" (o h1 é o
  // mesmo elemento). Sem o achado, valem os estados de sempre (carregando, 404, erro).
  // O estado sintético zera também o `error`: um refetch que falhou em segundo plano não pode
  // virar 404 ou erro enquanto o corpo espera o catálogo.
  const query =
    body || finding.data === undefined
      ? finding
      : { data: undefined, error: null, isError: false, refetch: finding.refetch };

  return (
    <ReportScreen
      query={query}
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
      {(data) => <FindingBody auditId={auditId} finding={data} catalog={body?.catalog ?? null} liveCatalog={live} />}
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

function FindingBody({
  auditId,
  finding,
  catalog,
  liveCatalog,
}: {
  auditId: string;
  finding: FindingDetail;
  /** Catálogo de quando o corpo foi montado: decide as seções. */
  catalog: CriteriaCatalog | null;
  /** Catálogo de agora: só os rótulos curtos da lateral. */
  liveCatalog: CriteriaCatalog | null;
}) {
  // "Onde mais aparece" traz só a `url` pedida; o endereço exibido é o final, como no resto do
  // relatório, e vem da lista de páginas (a mesma do cache das outras telas).
  const pages = usePages(auditId);
  const finalUrl = new Map(pages.data?.data.map((p) => [p.id, p.final_url ?? p.url]));
  const ai = finding.source !== "axe";
  const criteria = criteriaFor(finding.wcag_criteria, catalog);
  const known = criteria.flatMap((ref) => (ref.criterion ? [ref.criterion] : []));
  const who = whoIsAffected(finding, criteria);
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

        {who && (
          <Reveal as="section" className="rp-card__section" aria-labelledby="quem-e-afetado">
            <h2 id="quem-e-afetado" className="rp-h3">
              {t.report.finding.who}
            </h2>
            {who.kind === "finding" ? (
              <p>{who.text}</p>
            ) : (
              <dl className="rp-card__dl rp-card__dl--stack">
                {who.items.map((item) => (
                  <Fragment key={item.id}>
                    <dt>{item.label}</dt>
                    <dd>{item.text}</dd>
                  </Fragment>
                ))}
              </dl>
            )}
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
              <Link href={finding.help_url} external standalone>
                {t.report.finding.docs(finding.rule_id)}
              </Link>
            </p>
          )}
        </Reveal>

        {known.length > 0 && catalog && <RelatedCriteria criteria={known} catalog={catalog} />}
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
            <dd>{criteriaText(finding.wcag_criteria, liveCatalog)}</dd>
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

/**
 * "Critérios relacionados": um h3 por critério conhecido, com nível em texto, resumo, link da
 * tradução autorizada e as recomendações do eMAG que citam o critério (FR-007, CA3.1–CA3.4).
 */
function RelatedCriteria({ criteria, catalog }: { criteria: readonly WcagCriterion[]; catalog: CriteriaCatalog }) {
  const texts = t.report.criteria;
  const emagUrl = catalog.sources.emag.url;
  return (
    <Reveal as="section" className="rp-card__section" aria-labelledby="criterios-relacionados">
      <h2 id="criterios-relacionados" className="rp-h3">
        {texts.title}
      </h2>
      <p>{texts.intro(criteria.length)}</p>
      <div className="rp-criteria">
        {criteria.map((criterion) => {
          const recommendations = [...criterion.emag].sort((a, b) => compareNumbering(a.id, b.id));
          return (
            <div className="rp-criterion" key={criterion.id}>
              <h3 className="rp-criterion__title">{criterionShortLabel({ id: criterion.id, criterion })}</h3>
              <p className="rp-caption">{texts.level(criterion.level)}</p>
              <p>{criterion.summary}</p>
              {isHttpsUrl(criterion.url) && (
                <p>
                  <Link href={criterion.url} external standalone>
                    {texts.official(criterion.id)}
                  </Link>
                </p>
              )}
              {recommendations.length > 0 ? (
                <>
                  <h4>{texts.emagTitle(criterion.id)}</h4>
                  <ul className="rp-criterion__emag">
                    {recommendations.map((recommendation) => (
                      <li key={recommendation.id}>{texts.emagItem(recommendation.id, recommendation.title)}</li>
                    ))}
                  </ul>
                  {isHttpsUrl(emagUrl) && (
                    <p>
                      <Link href={emagUrl} external standalone>
                        {texts.emagLink}
                      </Link>
                    </p>
                  )}
                </>
              ) : (
                <p>{criterion.since === "2.0" ? texts.emagNone : texts.emagBefore}</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="rp-caption">{texts.attribution}</p>
    </Reveal>
  );
}
