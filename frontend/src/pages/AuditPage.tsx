// `/auditorias/:id` (RF-RA004, RF-RA014). Enquanto a auditoria anda, é a tela de progresso
// (design/components/TelaVarredura), alimentada pelo canal `audit:<id>` (`useAuditChannel`).
// Auditoria que já estava encerrada ao abrir mostra o relatório; no M2 ele ainda é o aviso de
// tela em construção (`feat/tela-relatorio`). Quem acompanhou o fim ao vivo continua na tela de
// progresso, ouve a conclusão uma vez e chega ao relatório pelo botão "Ver relatório".
//
// Leitor de tela: a única região viva é a `LiveRegion` desta tela, montada vazia desde o
// primeiro quadro (inclusive carregando) e fora das trocas de estado: fala os marcos de 25%
// do `ScanProgress` e a conclusão. Contadores, etapas, feed e a linha de conexão não falam.
import { useEffect, useRef, useState, type Ref } from "react";
import { useParams } from "react-router";
import { isFinalStatus, progressFromSummary, useAuditChannel, type ConnectionState, type PageActivity } from "../api/channel";
import { isApiError } from "../api/client";
import { useAudit, usePages } from "../api/hooks";
import type { AuditStatus, AuditSummary, ChannelProgress, PageSummary } from "../api/types";
import { ActivityFeed, type ActivityItem } from "../components/ActivityFeed";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Link } from "../components/Link";
import { LiveRegion } from "../components/LiveRegion";
import { PageTitle } from "../components/PageTitle";
import { ScanProgress, type ScanStatus } from "../components/ScanProgress";
import { ScanSteps } from "../components/ScanSteps";
import { StatCard, StatGrid } from "../components/StatCard";
import { StateMessage } from "../components/StateMessage";
import { formatAt, formatTimeWithSeconds, plural, t } from "../i18n";
import { severityLabel, severityPluralLabel, severityTotals, totalProblems } from "../severity";
import { isAuditId } from "./AuditPlaceholderPage";
import { NotFoundPage } from "./NotFoundPage";

export function AuditPage() {
  const { id } = useParams();
  if (!isAuditId(id)) return <NotFoundPage />;
  // `key`: outra auditoria começa do zero (estado local e região viva novos).
  return <AuditView key={id} auditId={id} />;
}

/** Host do endereço auditado, para o título ("Auditando exemplo.com.br"). */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function scanStatus(progress: ChannelProgress): ScanStatus {
  switch (progress.status) {
    case "queued":
      return "queued";
    case "running":
      return progress.pages_found === 0 ? "discovering" : "running";
    case "completed":
      return "done";
    default:
      return progress.status;
  }
}

type FinalOrRunning = "running" | "completed" | "failed" | "cancelled";

function titleKey(status: AuditStatus): FinalOrRunning {
  return status === "queued" ? "running" : status;
}

// No M2 a etapa vem do `status`: na fila → varredura automática → relatório.
function currentStep(status: AuditStatus): { current: number; stopped: boolean } {
  switch (status) {
    case "queued":
      return { current: 0, stopped: false };
    case "running":
      return { current: 1, stopped: false };
    case "completed":
      return { current: t.audit.steps.items.length, stopped: false };
    default:
      return { current: 1, stopped: true };
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Itens do feed, o mais recente primeiro; caminho e hora vêm da lista de páginas da API. */
function feedItems(pages: readonly PageActivity[], list: readonly PageSummary[] | undefined): ActivityItem[] {
  const byId = new Map(list?.map((page) => [page.id, page]));
  return [...pages].reverse().map((activity) => {
    const page = byId.get(activity.pageId);
    const path = page ? pathOf(page.final_url ?? page.url) : null;
    const text =
      activity.kind === "scanned"
        ? t.audit.feed.scanned(
            activity.counts.critical + activity.counts.serious + activity.counts.moderate + activity.counts.minor,
          )
        : t.audit.feed.failed(activity.error.message);
    const scannedAt = page?.scanned_at ? new Date(page.scanned_at) : null;
    return {
      id: `${activity.pageId}:${activity.kind}`,
      status: activity.kind === "scanned" ? "ok" : "falha",
      path,
      text: path === null ? `${t.audit.feed.page} ${text}` : text,
      time:
        scannedAt && !Number.isNaN(scannedAt.getTime())
          ? { label: formatTimeWithSeconds(scannedAt), iso: scannedAt.toISOString() }
          : undefined,
    };
  });
}

/** Intervalo mínimo entre buscas da lista de páginas para o feed (caminho e hora). */
export const PAGES_REFRESH_MS = 5_000;
/** Tentativas por página ausente da lista antes de desistir do caminho dela. */
export const PAGES_MAX_TRIES = 3;

type View = "loading" | "not-found" | "error" | "report" | "progress";

function AuditView({ auditId }: { auditId: string }) {
  const summary = useAudit(auditId);
  const channel = useAuditChannel(auditId);
  const progress = channel.progress ?? (summary.data ? progressFromSummary(summary.data) : null);

  // Acompanhada ao vivo: só quando o estado do canal (join, evento ou o GET do próprio hook)
  // mostrou a auditoria aberta. O resumo em cache pode ser velho (o prefetch da tela inicial
  // diz `queued`) e não conta: auditoria já encerrada vai direto ao relatório, sem anúncio.
  const [liveSeen, setLiveSeen] = useState(false);
  if (channel.progress !== null && !isFinalStatus(channel.progress.status) && !liveSeen) setLiveSeen(true);
  const [showReport, setShowReport] = useState(false);
  const [milestone, setMilestone] = useState("");
  const reportTitle = useRef<HTMLHeadingElement>(null);

  const host = hostOf(summary.data?.start_url);
  const summaryError = isApiError(summary.error) ? summary.error : null;
  const notFound = channel.error?.code === "audit_not_found" || summaryError?.code === "audit_not_found";
  // Join recusado por outro motivo (ex.: limite de canais): a tela segue pelo resumo e pelo GET
  // periódico do hook, com um aviso de que não há atualização ao vivo.
  const offline = channel.error !== null && !notFound;

  const view: View = notFound
    ? "not-found"
    : progress === null
      ? summary.isError
        ? "error"
        : "loading"
      : showReport || (isFinalStatus(progress.status) && progress.status === "completed" && !liveSeen)
        ? "report"
        : "progress";

  // Da tela de progresso para o relatório ("Ver relatório" ou a auditoria que já tinha
  // terminado): o foco vai para o novo título, como numa troca de rota.
  const previousView = useRef<View>(view);
  useEffect(() => {
    if (view === "report" && previousView.current === "progress") reportTitle.current?.focus();
    previousView.current = view;
  }, [view]);

  return (
    <>
      {view === "not-found" ? (
        <>
          <PageTitle>{t.audit.notFoundTitle}</PageTitle>
          <StateMessage
            kind="erro"
            title={t.audit.notFoundState}
            text={channel.error?.message ?? summaryError?.message}
            actions={
              <Link href="/" standalone>
                {t.audit.newAudit}
              </Link>
            }
          />
        </>
      ) : view === "error" ? (
        <>
          <PageTitle>{t.audit.loadErrorTitle}</PageTitle>
          <StateMessage
            kind="erro"
            title={t.audit.loadErrorTitle}
            text={summaryError?.message ?? t.errors.internal_error}
            actions={
              <Button variant="secondary" onClick={() => void summary.refetch()}>
                {t.audit.retry}
              </Button>
            }
          />
        </>
      ) : view === "loading" || progress === null ? (
        <>
          <PageTitle>{t.audit.loadingTitle}</PageTitle>
          <StateMessage kind="carregando" title={t.audit.loading} />
        </>
      ) : view === "report" ? (
        <ReportPlaceholder host={host} progress={progress} titleRef={reportTitle} />
      ) : (
        <ProgressView
          auditId={auditId}
          host={host}
          summary={summary.data}
          progress={progress}
          connection={channel.connection}
          offline={offline}
          pages={channel.pages}
          onMilestone={setMilestone}
          onViewReport={() => setShowReport(true)}
        />
      )}
      {/* Fora das trocas de estado acima: a mesma região do primeiro ao último quadro. */}
      <LiveRegion text={channel.announcement ?? milestone} />
    </>
  );
}

function ReportPlaceholder({
  host,
  progress,
  titleRef,
}: {
  host: string | null;
  progress: ChannelProgress;
  titleRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <>
      <PageTitle ref={titleRef}>{host ? t.audit.report.title(host) : t.audit.report.titleNoHost}</PageTitle>
      <StateMessage
        kind="vazio"
        icon="relogio"
        title={t.audit.report.stateTitle}
        text={t.audit.report.summary(totalProblems(progress.totals_by_severity), progress.pages_scanned)}
        actions={
          <Link href="/" standalone>
            {t.audit.newAudit}
          </Link>
        }
      >
        <p className="rp-state__text">{t.audit.report.text}</p>
      </StateMessage>
    </>
  );
}

function ConnectionLine({ state }: { state: ConnectionState }) {
  return (
    <p className={`rp-conn rp-conn--${state}`}>
      {state === "open" ? (
        <span className="rp-live" aria-hidden="true" />
      ) : (
        <Icon name={state === "reconnecting" ? "serio" : "relogio"} size="sm" />
      )}
      {t.audit.connection[state]}
    </p>
  );
}

function ProgressView({
  auditId,
  host,
  summary,
  progress,
  connection,
  offline,
  pages,
  onMilestone,
  onViewReport,
}: {
  auditId: string;
  host: string | null;
  summary: AuditSummary | undefined;
  progress: ChannelProgress;
  connection: ConnectionState;
  offline: boolean;
  pages: readonly PageActivity[];
  onMilestone: (text: string) => void;
  onViewReport: () => void;
}) {
  const pageList = usePages(auditId);
  const final = isFinalStatus(progress.status);
  const key = titleKey(progress.status);
  const title = host ? t.audit.title[key](host) : t.audit.titleNoHost[key];
  const step = currentStep(progress.status);

  // Página no feed sem caminho conhecido (o canal só manda o id, PRD §9): a lista de páginas é
  // buscada de novo, no máximo uma vez a cada `PAGES_REFRESH_MS`, por mais páginas que
  // cheguem. Página que continua fora da lista (ou busca que falhou) tenta de novo na janela
  // seguinte, até `PAGES_MAX_TRIES` vezes. No fim da auditoria o hook do canal busca a lista
  // mais uma vez.
  const tries = useRef(new Map<string, number>());
  const lastFetch = useRef(0);
  const [wake, setWake] = useState(0);
  const known = pageList.data?.data;
  const fetching = pageList.isFetching;
  const refetch = pageList.refetch;
  const updatedAt = Math.max(pageList.dataUpdatedAt, pageList.errorUpdatedAt);
  useEffect(() => {
    if (fetching) return;
    const ids = new Set(known?.map((p) => p.id));
    const missing = pages
      .map((p) => p.pageId)
      .filter((id) => !ids.has(id) && (tries.current.get(id) ?? 0) < PAGES_MAX_TRIES);
    if (missing.length === 0) return;
    const wait = Math.max(lastFetch.current, updatedAt) + PAGES_REFRESH_MS - Date.now();
    if (wait > 0) {
      const timer = setTimeout(() => setWake((n) => n + 1), wait);
      return () => clearTimeout(timer);
    }
    lastFetch.current = Date.now();
    for (const id of missing) tries.current.set(id, (tries.current.get(id) ?? 0) + 1);
    void refetch();
  }, [pages, known, fetching, refetch, updatedAt, wake]);

  const started = summary ? new Date(summary.inserted_at) : null;

  return (
    <>
      <div className="rp-page-head">
        <PageTitle>{title}</PageTitle>
        {summary && started && !Number.isNaN(started.getTime()) && (
          <p className="rp-caption">
            {t.audit.started(formatAt(started), plural(summary.page_limit, "página", "páginas"))}
          </p>
        )}
      </div>

      {offline && (
        // Visível e lido na ordem da página; não é região viva (a única é a da tela).
        <div className="rp-notice">
          <Icon name="info" />
          <p>
            <strong>{t.audit.connection.offlineTitle}.</strong> {t.audit.connection.offlineText}
          </p>
        </div>
      )}

      <ScanSteps label={t.audit.steps.label} steps={t.audit.steps.items} current={step.current} stopped={step.stopped} />

      <div className="rp-split rp-split--reverse rp-audit__live">
        <ScanProgress
          url={summary?.start_url ?? null}
          status={scanStatus(progress)}
          found={progress.pages_found}
          scanned={progress.pages_scanned}
          failed={progress.pages_failed}
          errorMessage={progress.error?.message ?? null}
          onMilestone={onMilestone}
          connection={final || offline ? undefined : <ConnectionLine state={connection} />}
          actions={
            progress.status === "completed" ? (
              <Button onClick={onViewReport}>{t.audit.viewReport}</Button>
            ) : final ? (
              <Link href="/" standalone>
                {t.audit.newAudit}
              </Link>
            ) : undefined
          }
        />
        <ActivityFeed title={t.audit.feed.title} items={feedItems(pages, known)} empty={t.audit.feed.empty} />
      </div>

      <section className="rp-section" aria-labelledby="problemas-ate-agora">
        <h2 id="problemas-ate-agora" className="rp-h2">
          {final ? t.audit.findings.titleDone : t.audit.findings.titleRunning}
        </h2>
        <p className="rp-caption">{final ? t.audit.findings.noteDone : t.audit.findings.note}</p>
        <StatGrid>
          {severityTotals(progress.totals_by_severity).map(({ severity, count }) => (
            <StatCard
              key={severity}
              label={severityPluralLabel(severity)}
              value={count}
              icon={severity}
              tone={severity}
            />
          ))}
          <StatCard
            label={severityLabel("revisao")}
            value={progress.needs_review_count}
            icon="revisao"
            tone="revisao"
          />
        </StatGrid>
      </section>
    </>
  );
}
