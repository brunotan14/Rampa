// Tela inicial (design/components/TelaInicial, RF-RA001): faixa de destaque com o campo de URL,
// como funciona e o aviso de que a verificação automática não garante conformidade.
// "Um relatório que todo mundo entende" mostra um exemplo com dados fictícios (a pontuação real
// é do M3), sem o link para um relatório de exemplo, que ainda não existe.
// Fora no M2: auditorias recentes (RF-RA018, `feat/recentes-e-retencao`), Entrar e Planos (pós-MVP).
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { getAudit, isApiError } from "../api/client";
import { useCreateAudit } from "../api/hooks";
import { queryKeys } from "../api/queryKeys";
import { Icon } from "../components/Icon";
import { Mosaic } from "../components/Mosaic";
import { PageTitle } from "../components/PageTitle";
import { ScoreIndicator } from "../components/ScoreIndicator";
import { SeverityBar, type SeverityBarItem } from "../components/SeverityBar";
import { UrlAuditField, type UrlFieldError } from "../components/UrlAuditField";
import { errorMessage, formatFrom, t } from "../i18n";

const EXAMPLE_ITEMS: SeverityBarItem[] = (["critico", "serio", "moderado", "menor", "revisao"] as const).map((level) => ({
  level,
  count: t.home.example.counts[level],
}));

// Códigos em que o problema é o endereço digitado (o campo fica `aria-invalid`).
const URL_ERRORS = new Set(["invalid_body", "unsupported_scheme", "invalid_url", "blocked_address", "unresolvable"]);

/** Mensagem do erro da criação, ligada ao campo. O 429 diz o horário no fuso de quem usa. */
export function createAuditError(error: unknown, now: Date = new Date()): UrlFieldError {
  if (!isApiError(error)) return { message: errorMessage("internal_error"), invalid: false };
  if (error.retryAfter !== null && error.code === "rate_limited") {
    return { message: t.urlField.rateLimited(formatFrom(error.retryAfter, now)), invalid: false };
  }
  if (error.retryAfter !== null && error.code === "daily_limit_reached") {
    return { message: t.urlField.dailyLimitReached(formatFrom(error.retryAfter, now)), invalid: false };
  }
  return { message: error.message, invalid: URL_ERRORS.has(error.code) };
}

export function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useCreateAudit();
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<{ error: UrlFieldError; key: number } | null>(null);

  function start(url: string) {
    setFailure(null);
    create.mutate(
      { url },
      {
        onSuccess: async ({ id }) => {
          // O resumo (endereço normalizado, status) é buscado antes de trocar de tela: o h1 da
          // tela de progresso já nasce com o host. Se falhar, a tela busca sozinha.
          setOpening(true);
          await queryClient
            .fetchQuery({ queryKey: queryKeys.audit(id), queryFn: ({ signal }) => getAudit(id, { signal }) })
            .catch(() => undefined);
          void navigate(`/auditorias/${id}`);
        },
        onError: (error) => setFailure((previous) => ({ error: createAuditError(error), key: (previous?.key ?? 0) + 1 })),
      },
    );
  }

  return (
    <>
      <section className="rp-hero-band" aria-labelledby="titulo-inicio">
        <div className="rp-container rp-hero-band__grid">
          <div className="rp-hero-band__copy rp-enter">
            <p className="rp-pill">
              <Icon name="revisao" size="sm" />
              {t.home.pill}
            </p>
            <PageTitle id="titulo-inicio" emphasis={t.home.titleEmphasis} className="rp-h1 rp-display">
              {t.home.title}
            </PageTitle>
            <p className="rp-lead">{t.home.lead}</p>
            <UrlAuditField
              onSubmit={start}
              loading={create.isPending || opening}
              error={failure?.error ?? null}
              errorKey={failure?.key ?? 0}
            />
            <ul className="rp-trust" aria-label={t.home.trustLabel}>
              {t.home.trust.map((item) => (
                <li key={item}>
                  <Icon name="sucesso" size="sm" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <Mosaic />
        </div>
      </section>

      <div className="rp-container rp-home">
        <section className="rp-section" aria-labelledby="como-funciona">
          <h2 id="como-funciona" className="rp-h2">
            {t.home.howTitle}
          </h2>
          <ol className="rp-howto">
            {t.home.how.map((step) => (
              <li key={step.title}>
                <h3 className="rp-h3">{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="rp-section" aria-labelledby="relatorio-exemplo">
          <h2 id="relatorio-exemplo" className="rp-h2">
            {t.home.example.title}
          </h2>
          <p className="rp-caption">{t.home.example.note}</p>
          <div className="rp-grid">
            <div className="rp-panel">
              <ScoreIndicator value={t.home.example.score} description={t.home.example.scoreText} />
            </div>
            <div className="rp-panel">
              <h3 className="rp-h3">{t.home.example.summaryTitle}</h3>
              <SeverityBar items={EXAMPLE_ITEMS} label={t.home.example.barLabel} />
            </div>
          </div>
        </section>
        <p className="rp-caption rp-disclaimer">{t.home.disclaimer}</p>
      </div>
    </>
  );
}

