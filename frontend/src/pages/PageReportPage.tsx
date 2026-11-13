// Relatório de uma página (RF-RA006, RF-RA017, RF-RA028; design/components/TelaRelatorioDetalhado),
// em `/auditorias/:id/paginas/:pageId`: cabeçalho da página, aviso de barreira de login, totais
// por severidade e duas abas: "Problemas" (com filtros de severidade, origem, critério WCAG e
// revisão na URL, pela API de achados) e "Aprovados" (regras do axe que passaram, selo
// "Aprovado" por regra, nunca "página acessível"). A aba também fica na URL (`?aba=aprovados`).
//
// Leitor de tela: a contagem de problemas é a única região viva (`status`), falada quando os
// filtros mudam o resultado; aplicar o filtro não move o foco. "Mostrar mais problemas" leva o
// foco ao primeiro elemento novo da lista. Com a auditoria em andamento, a página e os problemas
// são buscados de novo a cada 5 s, e uma vez no fim.
// Fora no M2: Reauditar só a página, Exportar CSV, recorte de tela do elemento.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Tab, TabList, TabPanel, Tabs, type Key } from "react-aria-components";
import { useParams, useSearchParams } from "react-router";
import { useFindings, usePage } from "../api/hooks";
import type { PageDetail } from "../api/types";
import { AxeText } from "../components/AxeText";
import { Button } from "../components/Button";
import { FindingGroup, findingLinkId, groupFindings } from "../components/FindingGroup";
import { Icon } from "../components/Icon";
import { PageStatus } from "../components/PageStatus";
import { SeverityBadge } from "../components/SeverityBadge";
import { SeverityBar } from "../components/SeverityBar";
import { StateMessage } from "../components/StateMessage";
import { formatAt, formatNumber, t } from "../i18n";
import {
  SOURCES,
  WCAG_CRITERION,
  hasFindingFilters,
  hostOf,
  isAuditId,
  pageName,
  pagesPath,
  readFindingFilters,
  toApiFilters,
  writeFindingFilters,
  type FindingFilterState,
} from "../report";
import { FINDING_SEVERITIES, severityLabel, severityTotals, totalProblems } from "../severity";
import { NotFoundPage } from "./NotFoundPage";
import { LoadErrorState, LoginWallNotice, ReportScreen, RunningNotice, reportCrumb, useLiveAudit } from "./reportParts";

export function PageReportPage() {
  const { id, pageId } = useParams();
  if (!isAuditId(id) || !isAuditId(pageId)) return <NotFoundPage />;
  return <PageReportView key={`${id}/${pageId}`} auditId={id} pageId={pageId} />;
}

type TabKey = "problemas" | "aprovados";

function PageReportView({ auditId, pageId }: { auditId: string; pageId: string }) {
  const { summary, running, refetchInterval } = useLiveAudit(auditId);
  const page = usePage(auditId, pageId, { refetchInterval });
  const host = hostOf(summary.data?.start_url);

  return (
    <ReportScreen
      query={page}
      title={pageName}
      loadingTitle={t.report.page.loadingTitle}
      loadingText={t.report.page.loading}
      notFound={{
        title: t.report.page.notFoundTitle,
        state: t.report.page.notFoundState,
        back: { href: pagesPath(auditId), label: t.report.page.backToPages },
      }}
      crumbs={(data) => [
        reportCrumb(auditId, host),
        { label: t.report.crumbs.pages, href: pagesPath(auditId) },
        { label: pageName(data) },
      ]}
      head={(data) => <PageHead page={data} />}
    >
      {(data) => <PageBody auditId={auditId} page={data} running={running} refetchInterval={refetchInterval} />}
    </ReportScreen>
  );
}

function PageHead({ page }: { page: PageDetail }) {
  const scannedAt = page.scanned_at ? new Date(page.scanned_at) : null;
  return (
    <div className="rp-pagehead">
      <span className="rp-pages__path">{page.url}</span>
      {page.final_url && page.final_url !== page.url ? (
        <span className="rp-caption">
          {t.report.page.redirected} <span className="rp-pages__path rp-inline">{page.final_url}</span>
        </span>
      ) : null}
      <span className="rp-pages__status">
        <PageStatus status={page.status} />
        {scannedAt && !Number.isNaN(scannedAt.getTime()) ? (
          <span className="rp-caption">{t.report.page.scannedAt(formatAt(scannedAt))}</span>
        ) : null}
      </span>
    </div>
  );
}

function PageBody({
  auditId,
  page,
  running,
  refetchInterval,
}: {
  auditId: string;
  page: PageDetail;
  running: boolean;
  refetchInterval: number | false;
}) {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get("aba") === "aprovados" ? "aprovados" : "problemas";
  const problems = totalProblems(page.counts_by_severity) + page.needs_review_count;
  const passedCount = page.passed_count ?? page.passed_rules?.length ?? null;
  const resultsId = useId();

  const selectTab = (key: Key) => {
    const next = new URLSearchParams(params);
    if (key === "aprovados") next.set("aba", "aprovados");
    else next.delete("aba");
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <div className="rp-report rp-vt-painel">
      {running && <RunningNotice auditId={auditId} />}
      {page.login_wall === true && <LoginWallNotice />}

      {page.status === "failed" ? (
        <StateMessage
          kind="erro"
          alert={false}
          title={t.report.page.failedTitle}
          text={page.error?.message ?? t.errors.internal_error}
        />
      ) : page.status === "queued" || page.status === "scanning" ? (
        <StateMessage kind="vazio" icon="relogio" title={t.report.page.pendingTitle} text={t.report.page.pendingText} />
      ) : (
        <section className="rp-section rp-section--flush" aria-labelledby={resultsId}>
          <h2 id={resultsId} className="rp-h2">
            {t.report.page.tabsLabel}
          </h2>
          {problems > 0 ? (
            <SeverityBar
              label={t.report.page.barLabel}
              items={[
                ...severityTotals(page.counts_by_severity).map(({ severity, count }) => ({ level: severity, count })),
                { level: "revisao" as const, count: page.needs_review_count },
              ]}
            />
          ) : (
            <p className="rp-caption rp-with-icon">
              <Icon name="info" size="sm" />
              {t.report.page.noProblems}
            </p>
          )}
          <Tabs selectedKey={tab} onSelectionChange={selectTab} className="rp-tabs">
            <TabList aria-labelledby={resultsId} className="rp-tabs__list">
              <Tab id="problemas" className="rp-tab">
                {t.report.page.tabs.problems}{" "}
                <span className="rp-count">{formatNumber(problems)}</span>
              </Tab>
              <Tab id="aprovados" className="rp-tab">
                {t.report.page.tabs.passed}
                {passedCount !== null && (
                  <>
                    {" "}
                    <span className="rp-count">{formatNumber(passedCount)}</span>
                  </>
                )}
              </Tab>
            </TabList>
            <TabPanel id="problemas" className="rp-tabs__panel">
              <FindingsPanel auditId={auditId} pageId={page.id} refetchInterval={refetchInterval} />
            </TabPanel>
            <TabPanel id="aprovados" className="rp-tabs__panel">
              <PassedPanel page={page} />
            </TabPanel>
          </Tabs>
        </section>
      )}
    </div>
  );
}

// --- Problemas ---------------------------------------------------------------------------

const filterKey = (f: FindingFilterState) => [f.severidade, f.origem, f.wcag, f.revisao].join("|");

function FindingsPanel({
  auditId,
  pageId,
  refetchInterval,
}: {
  auditId: string;
  pageId: string;
  refetchInterval: number | false;
}) {
  const [params, setParams] = useSearchParams();
  const filters = readFindingFilters(params);
  const filtered = hasFindingFilters(filters);
  const findings = useFindings(auditId, toApiFilters(pageId, filters), { refetchInterval });
  const all = findings.data?.pages.flatMap((p) => p.data) ?? [];
  const total = findings.data?.pages[0]?.total ?? null;
  // Depois de "Mostrar mais", o foco vai para o primeiro elemento novo da lista. A posição dele
  // é marcada antes da busca e só o efeito foca, quando o lote novo já está na tela; o pedido é
  // desfeito ao focar ou se a busca não trouxer nada, então uma busca posterior (a de 5 s com a
  // auditoria em andamento) nunca rouba o foco de outro controle.
  const focusFrom = useRef<number | null>(null);
  useEffect(() => {
    const at = focusFrom.current;
    if (at === null) return;
    const next = findings.data?.pages.flatMap((p) => p.data)[at];
    if (!next) return;
    focusFrom.current = null;
    document.getElementById(findingLinkId(next.id))?.focus();
  }, [findings.data]);

  const apply = (next: FindingFilterState) =>
    setParams(writeFindingFilters(params, next), { replace: false, preventScrollReset: true });

  const showMore = () => {
    const before = all.length;
    focusFrom.current = before;
    void findings.fetchNextPage().then((result) => {
      const arrived = (result.data?.pages.flatMap((p) => p.data).length ?? 0) > before;
      if (!arrived || result.isError) focusFrom.current = null;
    });
  };

  const count =
    findings.isPending ? t.report.page.loadingFindings : total !== null ? t.report.page.count(total, filtered) : "";

  return (
    <div className="rp-findings">
      <FindingFilterForm value={filters} onApply={apply} onClear={() => apply({})} canClear={filtered} />
      <p className="rp-pages__count" role="status">
        {findings.isError && all.length === 0 ? "" : count}
      </p>
      {findings.isError && all.length === 0 ? (
        <LoadErrorState
          error={findings.error}
          title={t.report.page.loadErrorTitle}
          onRetry={() => void findings.refetch()}
        />
      ) : findings.isPending ? null : all.length === 0 ? (
        <StateMessage
          kind="vazio"
          headingLevel={3}
          icon={filtered ? "busca" : "info"}
          title={filtered ? t.report.page.emptyFilterTitle : t.report.page.emptyTitle}
          text={filtered ? t.report.page.emptyFilterText : t.report.page.emptyText}
          actions={
            filtered ? (
              <Button variant="secondary" onClick={() => apply({})}>
                {t.report.page.filters.clear}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {total !== null && <p className="rp-caption">{t.report.page.showing(all.length, total)}</p>}
          <div className="rp-findings__list">
            {groupFindings(all).map((group) => (
              <FindingGroup key={group.key} auditId={auditId} group={group} />
            ))}
          </div>
          {findings.isFetchNextPageError && (
            <p className="rp-again__error" role="alert">
              <Icon name="critico" size="sm" />
              <span>{findings.error?.message ?? t.errors.internal_error}</span>
            </p>
          )}
          {findings.hasNextPage && (
            <div>
              <Button
                variant="secondary"
                loading={findings.isFetchingNextPage}
                loadingLabel={t.report.page.moreLoading}
                onClick={showMore}
              >
                {t.report.page.more}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FindingFilterForm({
  value,
  onApply,
  onClear,
  canClear,
}: {
  value: FindingFilterState;
  onApply: (next: FindingFilterState) => void;
  onClear: () => void;
  canClear: boolean;
}) {
  const ids = { severity: useId(), source: useId(), wcag: useId(), hint: useId(), error: useId(), review: useId() };
  const wcagRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [wcagText, setWcagText] = useState(value.wcag ?? "");
  const [wcagError, setWcagError] = useState(false);
  // A URL mudou por fora (voltar do navegador, "Limpar filtros"): o formulário acompanha.
  const [seen, setSeen] = useState(filterKey(value));
  if (filterKey(value) !== seen) {
    setSeen(filterKey(value));
    setDraft(value);
    setWcagText(value.wcag ?? "");
    setWcagError(false);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wcag = wcagText.trim();
    if (wcag !== "" && !WCAG_CRITERION.test(wcag)) {
      setWcagError(true);
      wcagRef.current?.focus();
      return;
    }
    setWcagError(false);
    onApply({ ...draft, wcag: wcag === "" ? undefined : wcag });
  };

  return (
    <form className="rp-filters" aria-label={t.report.page.filters.label} onSubmit={submit} noValidate>
      <div className="rp-field">
        <label className="rp-field__label" htmlFor={ids.severity}>
          {t.report.page.filters.severity}
        </label>
        <select
          id={ids.severity}
          className="rp-select"
          value={draft.severidade ?? ""}
          onChange={(e) => setDraft({ ...draft, severidade: FINDING_SEVERITIES.find((s) => s === e.target.value) })}
        >
          <option value="">{t.report.page.filters.all}</option>
          {FINDING_SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severityLabel(severity)}
            </option>
          ))}
        </select>
      </div>
      <div className="rp-field">
        <label className="rp-field__label" htmlFor={ids.source}>
          {t.report.page.filters.source}
        </label>
        <select
          id={ids.source}
          className="rp-select"
          value={draft.origem ?? ""}
          onChange={(e) => setDraft({ ...draft, origem: SOURCES.find((s) => s === e.target.value) })}
        >
          <option value="">{t.report.page.filters.all}</option>
          {SOURCES.map((source) => (
            <option key={source} value={source}>
              {t.report.sources[source]}
            </option>
          ))}
        </select>
      </div>
      <div className="rp-field">
        <label className="rp-field__label" htmlFor={ids.wcag}>
          {t.report.page.filters.wcag}
        </label>
        <span className="rp-field__hint" id={ids.hint}>
          {t.report.page.filters.wcagHint}
        </span>
        <input
          ref={wcagRef}
          id={ids.wcag}
          className="rp-field__input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={wcagText}
          aria-invalid={wcagError || undefined}
          aria-describedby={wcagError ? `${ids.hint} ${ids.error}` : ids.hint}
          onChange={(e) => setWcagText(e.target.value)}
        />
        {wcagError && (
          <span className="rp-field__error" id={ids.error}>
            <Icon name="critico" size="sm" />
            {t.report.page.filters.wcagInvalid}
          </span>
        )}
      </div>
      <div className="rp-field">
        <label className="rp-field__label" htmlFor={ids.review}>
          {t.report.page.filters.review}
        </label>
        <select
          id={ids.review}
          className="rp-select"
          value={draft.revisao ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, revisao: e.target.value === "sim" || e.target.value === "nao" ? e.target.value : undefined })
          }
        >
          <option value="">{t.report.page.filters.reviewAll}</option>
          <option value="sim">{t.report.page.filters.reviewYes}</option>
          <option value="nao">{t.report.page.filters.reviewNo}</option>
        </select>
      </div>
      <div className="rp-filters__actions">
        <Button type="submit" variant="secondary">
          {t.report.page.filters.apply}
        </Button>
        {canClear && (
          <Button variant="ghost" onClick={onClear}>
            {t.report.page.filters.clear}
          </Button>
        )}
      </div>
    </form>
  );
}

// --- Aprovados (RF-RA017) ----------------------------------------------------------------

function PassedPanel({ page }: { page: PageDetail }) {
  const rules = page.passed_rules;
  if (rules === null) {
    return (
      <StateMessage
        kind="vazio"
        icon="info"
        headingLevel={3}
        title={t.report.passed.notCollectedTitle}
        text={t.report.passed.notCollectedText}
      />
    );
  }
  if (rules.length === 0) {
    return (
      <StateMessage kind="vazio" icon="info" headingLevel={3} title={t.report.passed.noneTitle} text={t.report.passed.noneText} />
    );
  }
  return (
    <div className="rp-passed">
      <p>{t.report.passed.intro(rules.length)}</p>
      <ul className="rp-passed__list" aria-label={t.report.passed.listLabel}>
        {rules.map((rule) => (
          <li key={rule.rule_id} className="rp-passed__item">
            <SeverityBadge level="sucesso" />
            <span className="rp-passed__text">
              <AxeText className="rp-passed__help">{rule.help}</AxeText>
              <span className="rp-caption">
                <code>{rule.rule_id}</code>
                {t.report.separator}
                {rule.wcag_criteria.length > 0 ? rule.wcag_criteria.map(t.report.criterion).join(", ") : t.report.noCriteria}
                {t.report.separator}
                {t.report.passed.nodes(rule.nodes_total)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

