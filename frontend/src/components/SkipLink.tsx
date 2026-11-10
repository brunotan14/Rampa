import { t } from "../i18n/pt-BR";

// design/components/SkipLink: primeiro elemento da página, aparece ao receber foco.
export function SkipLink({ href = "#conteudo" }: { href?: string }) {
  return (
    <a className="rp-skip" href={href}>
      {t.app.skipLink}
    </a>
  );
}
