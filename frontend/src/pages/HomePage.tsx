import { PageTitle } from "../components/PageTitle";
import { t } from "../i18n";

export function HomePage() {
  return (
    <>
      <PageTitle>{t.home.title}</PageTitle>
      <p className="rp-lead">{t.home.intro}</p>
      <p className="rp-caption">{t.home.disclaimer}</p>
    </>
  );
}
