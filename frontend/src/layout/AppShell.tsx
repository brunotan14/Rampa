// design/components/AppShell: a moldura de todas as telas. Marcos na ordem do design system
// (SkipLink, header, nav "Principal", main#conteudo, footer) e, ao trocar de rota, o foco
// vai para o h1 da nova tela, que o leitor de tela anuncia (03-padroes-de-tela.md).
// Só o que o MVP tem: sem Entrar, Planos, Histórico nem conta (pós-MVP, PRD §5).
import { useEffect, useRef } from "react";
import { NavLink, Link as RouterLink, Outlet, useLocation } from "react-router";
import { Logo } from "../components/Logo";
import { SkipLink } from "../components/SkipLink";
import { t } from "../i18n";

export function AppShell() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  // Caminho da última tela que já recebeu o foco (ou da primeira carga). Guardado na
  // renderização inicial, não no efeito: a dupla execução do efeito no StrictMode vê o mesmo
  // caminho e não move o foco na primeira carga.
  const focusedPath = useRef(pathname);

  // Na primeira carga o foco fica onde o navegador o põe (o leitor de tela começa do topo).
  useEffect(() => {
    if (focusedPath.current === pathname) return;
    focusedPath.current = pathname;
    mainRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [pathname]);

  return (
    <>
      <SkipLink />
      <header className="rp-header">
        <div className="rp-container rp-header__row">
          <RouterLink to="/" className="rp-brand">
            <Logo title={t.app.homeLink} />
          </RouterLink>
          <nav aria-label={t.app.navLabel} className="rp-nav">
            <ul className="rp-nav__list">
              <li>
                {/* `end`: só a tela inicial é "Nova auditoria" (aria-current="page"). */}
                <NavLink to="/" end className="rp-nav__link">
                  {t.app.newAudit}
                </NavLink>
              </li>
            </ul>
          </nav>
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
