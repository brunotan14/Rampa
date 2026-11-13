// design/components/Breadcrumb: onde a pessoa está (Relatório → Páginas → Página → Problema) e
// o caminho de volta. Os separadores "/" vêm do CSS, para não serem lidos; o último item é o
// atual (`aria-current="page"`), em texto.
import { t } from "../i18n";
import { Link } from "./Link";

export interface Crumb {
  label: string;
  /** Sem `href`, é o item atual. */
  href?: string;
}

export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label={t.report.crumbs.label} className="rp-crumbs">
      <ol>
        {items.map((item, index) => (
          <li key={`${index}:${item.label}`}>
            {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
