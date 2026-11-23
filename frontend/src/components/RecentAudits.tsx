// "Auditorias recentes" da tela inicial (RF-RA018): as últimas auditorias criadas ou abertas
// neste navegador, no padrão da `PageList` compacta (design/03-padroes-de-tela.md §1). A lista
// vem do `localStorage` (`recentAudits.ts`); daqui só sai o pedido do status atual de cada item
// (`GET /api/audits/:id`, a mesma chave e busca do relatório).
//
// - A ordem é a da última abertura, guardada; respostas que chegam fora de ordem não a mudam.
// - Esta tela nunca grava a abertura (`recordRecent`): só atualiza o status guardado
//   (`updateRecentStatus`) e tira o que a API diz que não existe mais (`removeRecent`).
// - Cada item é um único link, cujo nome lê o endereço, a data de criação e o status.
//
// Leitor de tela: "Limpar lista" leva o foco ao título da seção e a região viva diz "Lista
// apagada.". Se o item com foco sai da lista (auditoria apagada), o foco também vai ao título,
// em vez de cair no início da página.
import { useQueries } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import { getAudit, isApiError } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { formatAt, t } from "../i18n";
import {
  clearRecent,
  readRecent,
  recentLabel,
  removeRecent,
  updateRecentStatus,
  type RecentAudit,
} from "../recentAudits";
import { reportPath } from "../report";
import { AuditStatus } from "./AuditStatus";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { LiveRegion } from "./LiveRegion";
import { Reveal } from "./Reveal";
import { StateMessage } from "./StateMessage";

const isNotFound = (error: unknown) => isApiError(error) && error.code === "audit_not_found";

export function RecentAudits() {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [items, setItems] = useState<RecentAudit[]>(readRecent);
  const [announcement, setAnnouncement] = useState("");
  // Último item que recebeu o foco (id), para devolver o foco ao título se ele sumir.
  const focused = useRef<string | null>(null);

  const results = useQueries({
    queries: items.map((item) => ({
      queryKey: queryKeys.audit(item.id),
      // Mesma busca do `useAudit`: a chave é compartilhada, e quem sincroniza a lista guardada é o
      // efeito abaixo, não a busca (outra tela pode ter feito a busca que este item reaproveita).
      queryFn: ({ signal }: { signal: AbortSignal }) => getAudit(item.id, { signal }),
      // Status atual ao abrir a tela inicial, mesmo com o resumo em cache.
      staleTime: 0,
    })),
  });

  const rows = items.flatMap((item, index) => {
    const result = results[index];
    if (isNotFound(result?.error)) return [];
    return [
      {
        item,
        status: result?.data?.status ?? item.status,
        stale: result?.isError === true,
      },
    ];
  });
  const goneKey = items
    .filter((_, index) => isNotFound(results[index]?.error))
    .map((item) => item.id)
    .join(" ");

  // Lista guardada em dia com as respostas: status novo regravado (sem mexer na ordem) e
  // auditoria que não existe mais removida.
  const syncKey = items
    .map((item, index) => {
      const result = results[index];
      if (isNotFound(result?.error)) return `${item.id}:gone`;
      return result?.data ? `${item.id}:${result.data.status}` : "";
    })
    .join(" ");
  useEffect(() => {
    for (const entry of syncKey.split(" ")) {
      const [id, state] = entry.split(":");
      if (!id || !state) continue;
      if (state === "gone") removeRecent(id);
      else updateRecentStatus(id, state as RecentAudit["status"]);
    }
  }, [syncKey]);

  // Item com foco que saiu da lista: o foco vai para o título da seção, no mesmo quadro.
  useLayoutEffect(() => {
    const id = focused.current;
    if (id === null || !goneKey.split(" ").includes(id)) return;
    focused.current = null;
    const active = document.activeElement;
    if (active === null || active === document.body) headingRef.current?.focus();
  }, [goneKey]);

  function clear() {
    clearRecent();
    headingRef.current?.focus();
    focused.current = null;
    setItems([]);
    setAnnouncement(t.home.recent.cleared);
  }

  function onFocus(event: FocusEvent<HTMLUListElement>) {
    focused.current = event.target.closest<HTMLElement>("[data-audit-id]")?.dataset.auditId ?? null;
  }

  function onBlur(event: FocusEvent<HTMLUListElement>) {
    // Foco que foi para outro elemento. Sem destino (o item saiu da página), fica guardado.
    if (event.relatedTarget !== null) focused.current = null;
  }

  return (
    <Reveal as="section" className="rp-section rp-recent" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} className="rp-h2" tabIndex={-1}>
        {t.home.recent.title}
      </h2>
      <p className="rp-caption rp-recent__notice">
        <Icon name="info" size="sm" />
        {t.home.recent.notice}
      </p>
      {rows.length === 0 ? (
        <StateMessage kind="vazio" headingLevel={3} title={t.home.recent.emptyTitle} text={t.home.recent.emptyText} />
      ) : (
        <>
          {/* Foco e desfoco só registram qual item tinha o foco; não há interação na lista. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <ul className="rp-recent__list" aria-label={t.home.recent.listLabel} onFocus={onFocus} onBlur={onBlur}>
            {rows.map(({ item, status, stale }) => (
              <RecentItem key={item.id} item={item} status={status} stale={stale} />
            ))}
          </ul>
          <div className="rp-recent__actions">
            <Button variant="secondary" onClick={clear}>
              {t.home.recent.clear}
            </Button>
          </div>
        </>
      )}
      <LiveRegion text={announcement} />
    </Reveal>
  );
}

function RecentItem({ item, status, stale }: { item: RecentAudit; status: RecentAudit["status"]; stale: boolean }) {
  const created = new Date(item.createdAt);
  // Vírgula só para o leitor de tela e espaço real entre as partes do nome do link (o espaço
  // dentro de um span oculto se perde no cálculo do nome). No Chromium o nome sai com um espaço
  // antes de cada vírgula ("endereço , data"), porque o span oculto (posição absoluta) conta como
  // bloco dentro do link flex; a fala é a mesma. `aria-label` montado à mão foi tentado e cai no
  // `label-content-name-mismatch` do axe.
  const sep = (
    <>
      <span className="rp-sr">{t.home.recent.separator}</span>{" "}
    </>
  );
  return (
    <li className="rp-recent__item" data-audit-id={item.id}>
      {/* `href` montado do id validado, nunca do endereço guardado. */}
      <Link href={reportPath(item.id)} className="rp-recent__link">
        <span className="rp-recent__url">{recentLabel(item.startUrl)}</span>
        {sep}
        <span className="rp-recent__meta">
          <time className="rp-recent__date" dateTime={item.createdAt}>
            {t.home.recent.created(formatAt(created))}
          </time>
          {sep}
          <AuditStatus status={status} />
          {stale && (
            <>
              {sep}
              <span className="rp-recent__stale">
                <Icon name="info" size="sm" />
                {t.home.recent.stale}
              </span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}
