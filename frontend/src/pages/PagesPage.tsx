// Páginas da auditoria (RF-RA006, design/components/PageList e TelaRelatorioDetalhado), em
// `/auditorias/:id/paginas`: URL, título, status e totais por severidade de cada página, com
// filtros (severidade e "revisão necessária", pelos totais da página) e ordem na URL. O link de
// cada página leva junto os filtros que valem também para os problemas dela. Origem e critério
// WCAG filtram os problemas, na tela da página (a lista da API só tem os totais).
//
// Leitor de tela: a contagem ("1 de 3 páginas") fica numa região `status`, montada com a tela e
// falada a cada troca de filtro, sem mover o foco. Fora no M2: busca por texto, Exportar CSV.
import { useId } from "react";
import { useParams, useSearchParams } from "react-router";
import { useAudit, usePages } from "../api/hooks";
import type { PageSummary } from "../api/types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Link } from "../components/Link";
import { PageStatus } from "../components/PageStatus";
import { SeverityBadge } from "../components/SeverityBadge";
import { StateMessage } from "../components/StateMessage";
import { t } from "../i18n";
import { useMotionAllowed } from "../motion";
import {
  PAGE_ORDERS,
  filterAndSortPages,
  hostOf,
  isAuditId,
  pageLinkSearch,
  pageName,
  pagePath,
  readPageListState,
  reportPath,
  writePageListState,
  type PageListState,
} from "../report";
import { API_SEVERITIES, FINDING_SEVERITIES, fromApiSeverity } from "../severity";
import { NotFoundPage } from "./NotFoundPage";
import {
  LoadErrorState,
  NotFoundState,
  ReportHead,
  RunningNotice,
  isNotFound,
  notFoundTitle,
  reportCrumb,
} from "./reportParts";

export function PagesPage() {
  const { id } = useParams();
  if (!isAuditId(id)) return <NotFoundPage />;
  return <PagesView key={id} auditId={id} />;
}

function PagesView({ auditId }: { auditId: string }) {
  const summary = useAudit(auditId);
  const pages = usePages(auditId);
  const host = hostOf(summary.data?.start_url);
  const error = pages.error ?? (isNotFound(summary.error) ? summary.error : null);

  const title = isNotFound(error)
    ? notFoundTitle(error, t.audit.notFoundTitle)
    : pages.data
      ? host
        ? t.report.pages.title(host)
        : t.report.pages.titleNoHost
      : pages.isError
        ? t.audit.loadErrorTitle
        : t.report.pages.loadingTitle;

  const running = summary.data !== undefined && (summary.data.status === "queued" || summary.data.status === "running");

  return (
    <>
      <ReportHead
        title={title}
        crumbs={pages.data ? [reportCrumb(auditId, host), { label: t.report.crumbs.pages }] : null}
      />
      {isNotFound(error) ? (
        <NotFoundState error={error} itemState={t.audit.notFoundState} back={{ href: "/", label: t.audit.newAudit }} />
      ) : pages.data ? (
        <>
          {running && <RunningNotice auditId={auditId} />}
          <PageList auditId={auditId} pages={pages.data.data} />
        </>
      ) : pages.isError ? (
        <LoadErrorState error={pages.error} title={t.audit.loadErrorTitle} onRetry={() => void pages.refetch()} />
      ) : (
        <StateMessage kind="carregando" title={t.report.pages.loading} />
      )}
    </>
  );
}

function PageList({ auditId, pages }: { auditId: string; pages: readonly PageSummary[] }) {
  const [params, setParams] = useSearchParams();
  const state = readPageListState(params);
  const shown = filterAndSortPages(pages, state);
  const motion = useMotionAllowed();
  const ids = { severity: useId(), review: useId(), order: useId(), list: useId() };

  // O filtro se aplica ao mudar a opção e a contagem é anunciada (design/components/Select:
  // "filtros que anunciam o resultado"). `replace`: trocar um filtro não enche o histórico.
  const update = (next: Partial<PageListState>) =>
    setParams(writePageListState(params, { ...state, ...next }), { replace: true, preventScrollReset: true });
  const filtered = state.severidade !== undefined || state.revisao !== undefined;
  const linkSearch = pageLinkSearch(state);

  if (pages.length === 0) {
    return (
      <StateMessage
        kind="vazio"
        title={t.report.pages.emptyTitle}
        text={t.report.pages.emptyText}
        actions={
          <Link href={reportPath(auditId)} standalone>
            {t.report.follow}
          </Link>
        }
      />
    );
  }

  return (
    <section className="rp-pages" aria-labelledby={ids.list}>
      <h2 id={ids.list} className="rp-sr">
        {t.report.pages.listLabel}
      </h2>
      <div className="rp-pages__filters" role="group" aria-label={t.report.pages.filtersLabel}>
        <div className="rp-field">
          <label className="rp-field__label" htmlFor={ids.severity}>
            {t.report.pages.severity}
          </label>
          <select
            id={ids.severity}
            className="rp-select"
            value={state.severidade ?? ""}
            onChange={(event) =>
              update({ severidade: FINDING_SEVERITIES.find((s) => s === event.target.value) })
            }
          >
            <option value="">{t.report.pages.severityAll}</option>
            {FINDING_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {t.report.pages.severityOption[severity]}
              </option>
            ))}
          </select>
        </div>
        <div className="rp-field">
          <label className="rp-field__label" htmlFor={ids.review}>
            {t.report.pages.review}
          </label>
          <select
            id={ids.review}
            className="rp-select"
            value={state.revisao ?? ""}
            onChange={(event) => update({ revisao: event.target.value === "sim" ? "sim" : undefined })}
          >
            <option value="">{t.report.pages.reviewAll}</option>
            <option value="sim">{t.report.pages.reviewYes}</option>
          </select>
        </div>
        <div className="rp-field">
          <label className="rp-field__label" htmlFor={ids.order}>
            {t.report.pages.order}
          </label>
          <select
            id={ids.order}
            className="rp-select"
            value={state.ordem}
            onChange={(event) => update({ ordem: PAGE_ORDERS.find((o) => o === event.target.value) ?? "gravidade" })}
          >
            {PAGE_ORDERS.map((order) => (
              <option key={order} value={order}>
                {t.report.pages.orders[order]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* A única região viva da tela: muda só quando o filtro muda o resultado. */}
      <p className="rp-pages__count" role="status">
        {t.report.pages.count(shown.length, pages.length)}
      </p>

      {shown.length === 0 ? (
        <StateMessage
          kind="vazio"
          headingLevel={3}
          title={t.report.pages.emptyFilterTitle}
          text={t.report.pages.emptyFilterText}
          actions={
            filtered ? (
              <Button variant="secondary" onClick={() => update({ severidade: undefined, revisao: undefined })}>
                {t.report.pages.clear}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="rp-pages__list" aria-labelledby={ids.list}>
          {shown.map((page) => (
            <PageItem
              key={page.id}
              href={pagePath(auditId, page.id, linkSearch)}
              page={page}
              viewTransition={motion}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PageItem({ page, href, viewTransition }: { page: PageSummary; href: string; viewTransition: boolean }) {
  const counts = API_SEVERITIES.map((severity) => ({
    level: fromApiSeverity(severity),
    count: page.counts_by_severity[severity],
  })).filter((item) => item.count > 0);
  return (
    <li className="rp-pages__item">
      <div className="rp-pages__main">
        <Link href={href} viewTransition={viewTransition}>
          {pageName(page)}
        </Link>
        <span className="rp-pages__path">{page.final_url ?? page.url}</span>
        <span className="rp-pages__status">
          <PageStatus status={page.status} />
          {page.login_wall === true && (
            <span className="rp-pstatus rp-pstatus--login">
              <Icon name="bloqueio" size="sm" />
              {t.report.loginWall.badge}
            </span>
          )}
        </span>
        {page.status === "failed" && page.error && <span className="rp-pages__error">{page.error.message}</span>}
      </div>
      {page.status !== "failed" && (
        <div className="rp-pages__sev">
          {counts.length > 0 ? (
            counts.map((item) => <SeverityBadge key={item.level} level={item.level} count={item.count} />)
          ) : page.status === "done" || page.status === "analyzing" ? (
            <span className="rp-caption">{t.report.pages.noProblems}</span>
          ) : null}
          {page.needs_review_count > 0 && <SeverityBadge level="revisao" count={page.needs_review_count} />}
        </div>
      )}
    </li>
  );
}
