// design/components/ActivityFeed: o que a varredura acabou de fazer, o mais recente no topo.
// De propósito NÃO é região viva (nem `role="log"`): uma varredura gera dezenas de eventos por
// minuto. Quem usa leitor de tela navega até o feed quando quiser; os anúncios ficam com o
// `ScanProgress`. Mostra no máximo os 6 últimos, o mais recente primeiro, numa `<ul>`: a ordem
// fica clara pela hora de cada item, e números de uma `<ol>` só dos 6 últimos (6, 5, 4...)
// diriam a quem usa leitor de tela uma posição que não é a real na varredura.
import { useId } from "react";
import { Icon, type IconName } from "./Icon";

export const FEED_MAX = 6;

export interface ActivityItem {
  id: string;
  status: "ok" | "falha" | "info";
  /** Caminho da página, em fonte mono; `null` quando ainda não se sabe. */
  path: string | null;
  text: string;
  /** Hora já formatada e o instante em ISO (`<time datetime>`). */
  time?: { label: string; iso: string };
}

const ICONS: Record<ActivityItem["status"], IconName> = { ok: "sucesso", falha: "serio", info: "info" };

export function ActivityFeed({ title, items, empty }: { title: string; items: readonly ActivityItem[]; empty: string }) {
  const titleId = useId();
  const shown = items.slice(0, FEED_MAX);
  return (
    <section className="rp-feed" aria-labelledby={titleId}>
      <h2 id={titleId} className="rp-feed__title">
        {title}
      </h2>
      {shown.length === 0 ? (
        <p className="rp-feed__empty">{empty}</p>
      ) : (
        <ul className="rp-feed__list">
          {shown.map((item) => (
            <li key={item.id} className={`rp-feed__item rp-feed__item--${item.status}`}>
              <Icon name={ICONS[item.status]} />
              <span className="rp-feed__text">
                {item.path !== null && <code className="rp-feed__path">{item.path}</code>} {item.text}
              </span>
              {item.time && (
                <time className="rp-feed__time" dateTime={item.time.iso}>
                  {item.time.label}
                </time>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
