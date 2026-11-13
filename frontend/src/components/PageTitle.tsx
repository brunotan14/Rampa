import { useEffect, type Ref } from "react";
import { documentTitle } from "../i18n";

export interface PageTitleProps {
  children: string;
  /** Trecho do título pintado em destaque (só visual: o texto lido é o mesmo). */
  emphasis?: string;
  className?: string;
  id?: string;
  /** Idioma do título quando não é o da página (o resumo de uma regra do axe, em inglês). */
  lang?: string;
  ref?: Ref<HTMLHeadingElement>;
}

// Um único h1 por tela, igual ao <title> do documento (design/03-padroes-de-tela.md).
export function PageTitle({ children, emphasis, className = "rp-h1", id, lang, ref }: PageTitleProps) {
  useEffect(() => {
    document.title = documentTitle(children);
  }, [children]);

  const at = emphasis ? children.lastIndexOf(emphasis) : -1;
  return (
    <h1 ref={ref} id={id} className={className} tabIndex={-1} lang={lang}>
      {at < 0 ? (
        children
      ) : (
        <>
          {children.slice(0, at)}
          <span className="rp-accent">{emphasis}</span>
          {children.slice(at + (emphasis?.length ?? 0))}
        </>
      )}
    </h1>
  );
}
