import { useEffect } from "react";
import { documentTitle } from "../i18n/pt-BR";

// Um único h1 por tela, igual ao <title> do documento (design/03-padroes-de-tela.md).
export function PageTitle({ children }: { children: string }) {
  useEffect(() => {
    document.title = documentTitle(children);
  }, [children]);

  return (
    <h1 className="rp-h1" tabIndex={-1}>
      {children}
    </h1>
  );
}
