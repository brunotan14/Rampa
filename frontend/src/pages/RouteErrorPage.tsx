// Erro inesperado ao montar uma tela: a moldura (AppShell) continua, com um h1 e o caminho de volta.
import { Link } from "../components/Link";
import { PageTitle } from "../components/PageTitle";
import { StateMessage } from "../components/StateMessage";
import { t } from "../i18n";

export function RouteErrorPage() {
  return (
    <>
      <PageTitle>{t.routeError.title}</PageTitle>
      <StateMessage
        kind="erro"
        title={t.routeError.stateTitle}
        text={t.routeError.text}
        actions={
          <Link href="/" standalone>
            {t.routeError.back}
          </Link>
        }
      />
    </>
  );
}
