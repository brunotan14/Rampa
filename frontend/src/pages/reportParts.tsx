// Peças comuns das telas do relatório (resumo, páginas, uma página, um problema): o cabeçalho
// com a trilha e o h1, e os estados de carregando, não encontrado e erro. O h1 fica sempre na
// mesma posição da árvore: ao trocar de "carregando" para o conteúdo, é o mesmo elemento (o foco
// que o `AppShell` pôs nele não se perde).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { isApiError } from "../api/client";
import { useAudit } from "../api/hooks";
import { queryKeys } from "../api/queryKeys";
import { Breadcrumb, type Crumb } from "../components/Breadcrumb";
import { Button } from "../components/Button";
import { Link } from "../components/Link";
import { Notice } from "../components/Notice";
import { PageTitle } from "../components/PageTitle";
import { StateMessage } from "../components/StateMessage";
import { t } from "../i18n";
import { LIVE_REFRESH_MS, isRunning, reportPath } from "../report";

export function ReportHead({
  crumbs,
  title,
  lang,
  titleRef,
  children,
}: {
  crumbs?: readonly Crumb[] | null;
  title: string;
  lang?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
}) {
  return (
    <div className="rp-page-head">
      {crumbs ? <Breadcrumb items={crumbs} /> : null}
      <PageTitle ref={titleRef} lang={lang}>
        {title}
      </PageTitle>
      {children}
    </div>
  );
}

/** Trilha a partir do relatório: "Relatório de exemplo.com.br / …". */
export function reportCrumb(auditId: string, host: string | null): Crumb {
  return { label: host ? t.report.crumbs.report(host) : t.report.crumbs.reportNoHost, href: reportPath(auditId) };
}

const NOT_FOUND = new Set(["audit_not_found", "page_not_found", "finding_not_found"]);

export function isNotFound(error: unknown): boolean {
  return isApiError(error) && NOT_FOUND.has(error.code);
}

/** Título da tela quando algo não foi encontrado: a auditoria inteira ou só o item. */
export function notFoundTitle(error: unknown, itemTitle: string): string {
  return isApiError(error) && error.code === "audit_not_found" ? t.audit.notFoundTitle : itemTitle;
}

/** Não encontrado (404): o motivo da API e o caminho de volta. */
export function NotFoundState({
  error,
  itemState,
  back,
}: {
  error: unknown;
  itemState: string;
  back: { href: string; label: string };
}) {
  const auditMissing = isApiError(error) && error.code === "audit_not_found";
  return (
    <StateMessage
      kind="erro"
      title={auditMissing ? t.audit.notFoundState : itemState}
      text={isApiError(error) ? error.message : undefined}
      actions={
        auditMissing ? (
          <Link href="/" standalone>
            {t.audit.newAudit}
          </Link>
        ) : (
          <Link href={back.href} standalone>
            {back.label}
          </Link>
        )
      }
    />
  );
}

/** Falha ao carregar (rede, 5xx, 429 longo): a mensagem da API e "Tentar de novo". */
export function LoadErrorState({ error, title, onRetry }: { error: unknown; title: string; onRetry: () => void }) {
  return (
    <StateMessage
      kind="erro"
      title={title}
      text={isApiError(error) ? error.message : t.errors.internal_error}
      actions={
        <Button variant="secondary" onClick={onRetry}>
          {t.audit.retry}
        </Button>
      }
    />
  );
}

/** A auditoria ainda anda: o que a tela mostra pode mudar. Leva à tela de progresso. */
export function RunningNotice({ auditId }: { auditId: string }) {
  return (
    <Notice icon="relogio">
      <p>
        {t.report.running}{" "}
        <Link href={reportPath(auditId)}>{t.report.follow}</Link>
      </p>
    </Notice>
  );
}

/** RF-RA028: aviso de barreira de login, com ícone de cadeado e texto. */
export function LoginWallNotice({ pages = 1 }: { pages?: number }) {
  return (
    <Notice icon="bloqueio" tone="atencao">
      <p>{pages === 1 ? t.report.loginWall.one : t.report.loginWall.many(pages)}</p>
    </Notice>
  );
}

/**
 * Resumo da auditoria nas telas internas (que não têm o canal): enquanto ela anda, o resumo e os
 * dados da tela (`refetchInterval`) são buscados de novo a cada `LIVE_REFRESH_MS`; quando ela
 * termina, tudo da auditoria é buscado uma vez, para a tela mostrar o resultado final.
 */
export function useLiveAudit(auditId: string) {
  const summary = useAudit(auditId, { liveMs: LIVE_REFRESH_MS });
  const running = isRunning(summary.data);
  const queryClient = useQueryClient();
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void queryClient.invalidateQueries({ queryKey: queryKeys.audit(auditId) });
    wasRunning.current = running;
  }, [running, auditId, queryClient]);
  return { summary, running, refetchInterval: running ? LIVE_REFRESH_MS : (false as const) };
}

interface ScreenQuery<T> {
  data: T | undefined;
  error: unknown;
  isError: boolean;
  refetch: () => unknown;
}

/**
 * Cabeçalho e corpo de uma tela do relatório pela mesma cascata: não encontrado (404), dados,
 * erro ao carregar e carregando. O h1 fica sempre na mesma posição (ver `ReportHead`).
 */
export function ReportScreen<T>({
  query,
  title,
  loadingTitle,
  loadingText,
  notFound,
  lang,
  crumbs,
  head,
  children,
}: {
  query: ScreenQuery<T>;
  /** Título com os dados. */
  title: (data: T) => string;
  loadingTitle: string;
  loadingText: string;
  /** Título e estado do item não encontrado (a auditoria inteira tem os seus) e o caminho de volta. */
  notFound: { title: string; state: string; back: { href: string; label: string } };
  lang?: (data: T) => string | undefined;
  crumbs?: (data: T) => readonly Crumb[];
  head?: (data: T) => ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { data, error, isError } = query;
  const missing = isNotFound(error);
  const screenTitle = missing
    ? notFoundTitle(error, notFound.title)
    : data !== undefined
      ? title(data)
      : isError
        ? t.audit.loadErrorTitle
        : loadingTitle;
  return (
    <>
      <ReportHead
        title={screenTitle}
        lang={!missing && data !== undefined ? lang?.(data) : undefined}
        crumbs={!missing && data !== undefined && crumbs ? crumbs(data) : null}
      >
        {!missing && data !== undefined && head ? head(data) : null}
      </ReportHead>
      {missing ? (
        <NotFoundState error={error} itemState={notFound.state} back={notFound.back} />
      ) : data !== undefined ? (
        children(data)
      ) : isError ? (
        <LoadErrorState error={error} title={t.audit.loadErrorTitle} onRetry={() => void query.refetch()} />
      ) : (
        <StateMessage kind="carregando" title={loadingText} />
      )}
    </>
  );
}
