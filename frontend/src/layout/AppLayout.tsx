import { useEffect, useRef } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { SkipLink } from "../components/SkipLink";
import { t } from "../i18n/pt-BR";
import assinatura from "../assets/rampa-assinatura.svg";
import assinaturaEscuro from "../assets/rampa-assinatura-escuro.svg";

export function AppLayout() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // Ao trocar de rota, o foco vai para o h1 da nova tela, que o leitor de tela anuncia.
  // Na primeira carga o foco fica onde o navegador o põe.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [pathname]);

  return (
    <>
      <SkipLink />
      <header className="rp-header">
        <div className="rp-container">
          <Link to="/" className="rp-brand">
            <picture>
              <source srcSet={assinaturaEscuro} media="(prefers-color-scheme: dark)" />
              <img src={assinatura} alt={t.app.homeLink} height={32} />
            </picture>
          </Link>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1} ref={mainRef} className="rp-container rp-main">
        <Outlet />
      </main>
      <footer className="rp-footer">
        <div className="rp-container">
          <p>{t.app.footer}</p>
        </div>
      </footer>
    </>
  );
}
