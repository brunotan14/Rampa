// design/components/StateMessage: os estados que não são conteúdo, vazio, erro e carregando.
// Diz o que aconteceu, por que e o que fazer (design/04-conteudo.md).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { Icon, type IconName } from "./Icon";

export const SLOW_LOADING_MS = 10_000;

interface CommonProps {
  /** Título; no carregando, o texto lido pelo leitor de tela (padrão "Carregando…"). */
  title?: string;
  /** O motivo e o próximo passo. */
  text?: ReactNode;
  icon?: IconName;
  /** Conteúdo extra, como a lista de causas. */
  children?: ReactNode;
  /** Ações de recuperação (botões e links). */
  actions?: ReactNode;
  /** Nível do título: 2 por padrão, 3 dentro de uma seção. */
  headingLevel?: 2 | 3;
  /** Leva o foco ao título ao aparecer (depois de um erro de varredura, por exemplo). */
  focusTitle?: boolean;
}

export type StateMessageProps =
  | (CommonProps & { kind: "vazio"; title: string })
  | (CommonProps & {
      kind: "erro";
      title: string;
      /**
       * `role="alert"`: use quando o erro aparece por causa de algo que acabou de acontecer
       * (padrão). Desligue para um erro que já está na tela ao abrir.
       */
      alert?: boolean;
    })
  | (CommonProps & {
      kind: "carregando";
      /** Depois deste tempo, mostra (e anuncia) o que está demorando. Padrão: 10 s. */
      slowAfterMs?: number;
      slowText?: string;
    });

const DEFAULT_ICON = { vazio: "busca", erro: "critico" } as const;

export function StateMessage(props: StateMessageProps) {
  if (props.kind === "carregando") return <Loading {...props} />;

  const { kind, title, text, icon, children, actions, headingLevel = 2, focusTitle } = props;
  const alert = kind === "erro" && (props.alert ?? true);
  return (
    <Section kind={kind} alert={alert} headingLevel={headingLevel} focusTitle={focusTitle} title={title}>
      <Icon name={icon ?? DEFAULT_ICON[kind]} className="rp-state__icon" />
      {text !== undefined && <p className="rp-state__text">{text}</p>}
      {children}
      {actions && <div className="rp-state__actions">{actions}</div>}
    </Section>
  );
}

function Section({
  kind,
  alert,
  headingLevel,
  focusTitle,
  title,
  children,
}: {
  kind: "vazio" | "erro";
  alert: boolean;
  headingLevel: 2 | 3;
  focusTitle?: boolean;
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const Heading = `h${headingLevel}` as const;

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle]);

  return (
    <section className={`rp-state rp-state--${kind}`} aria-labelledby={titleId} role={alert ? "alert" : undefined}>
      <Heading id={titleId} ref={titleRef} className="rp-state__title" tabIndex={focusTitle ? -1 : undefined}>
        {kind === "erro" && <span className="rp-sr">{t.state.errorPrefix}</span>}
        {kind === "erro" && " "}
        {title}
      </Heading>
      {children}
    </section>
  );
}

function Loading({
  title = t.state.loading,
  text,
  slowAfterMs = SLOW_LOADING_MS,
  slowText = t.state.loadingSlow,
}: Extract<StateMessageProps, { kind: "carregando" }>) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(timer);
  }, [slowAfterMs]);

  // `role="status"` (polite). Nem todo leitor de tela lê o texto de uma região que acabou de
  // ser montada, mas o aviso de demora entra numa região já montada e é lido.
  return (
    <div className="rp-state rp-state--carregando" role="status">
      <span className="rp-sr">{title}</span>
      <div className="rp-skeleton" aria-hidden="true">
        <span className="rp-skeleton__line" />
        <span className="rp-skeleton__line" />
        <span className="rp-skeleton__line rp-skeleton__line--short" />
      </div>
      {text !== undefined && <p className="rp-state__text">{text}</p>}
      {slow && <p className="rp-state__text">{slowText}</p>}
    </div>
  );
}
