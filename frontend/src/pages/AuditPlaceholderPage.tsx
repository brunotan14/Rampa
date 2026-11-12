// Rotas da auditoria (RF-RA014) enquanto as telas não chegam: a tela de progresso entra na
// `feat/tela-inicial-progresso` e o relatório na `feat/tela-relatorio`. Id que não é um UUID
// canônico cai no 404, como na API.
import { useParams } from "react-router";
import { Link } from "../components/Link";
import { PageTitle } from "../components/PageTitle";
import { StateMessage } from "../components/StateMessage";
import { t } from "../i18n";
import { NotFoundPage } from "./NotFoundPage";

// Mesma forma que a API e o canal aceitam: 36 caracteres, minúsculos.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAuditId(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}

export function AuditPlaceholderPage({ view }: { view: keyof typeof t.report.titles }) {
  const params = useParams();
  const ids = [params["id"], params["pageId"], params["findingId"]].filter((v) => v !== undefined);
  if (!ids.every(isAuditId)) return <NotFoundPage />;

  return (
    <>
      <PageTitle>{t.report.titles[view]}</PageTitle>
      <StateMessage
        kind="vazio"
        icon="relogio"
        title={t.report.underConstruction.title}
        text={t.report.underConstruction.text}
        actions={
          <Link href="/" standalone>
            {t.report.underConstruction.back}
          </Link>
        }
      />
    </>
  );
}
