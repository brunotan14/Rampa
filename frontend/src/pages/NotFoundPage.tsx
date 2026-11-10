import { Link } from "react-router";
import { PageTitle } from "../components/PageTitle";
import { t } from "../i18n/pt-BR";

export function NotFoundPage() {
  return (
    <>
      <PageTitle>{t.notFound.title}</PageTitle>
      <p>{t.notFound.text}</p>
      <p>
        <Link to="/">{t.notFound.back}</Link>
      </p>
    </>
  );
}
