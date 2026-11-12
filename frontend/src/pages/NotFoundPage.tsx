import { Link } from "../components/Link";
import { PageTitle } from "../components/PageTitle";
import { t } from "../i18n";

export function NotFoundPage() {
  return (
    <>
      <PageTitle>{t.notFound.title}</PageTitle>
      <p>{t.notFound.text}</p>
      <p>
        <Link href="/" standalone>
          {t.notFound.back}
        </Link>
      </p>
    </>
  );
}
