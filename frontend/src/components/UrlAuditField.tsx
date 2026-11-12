// design/components/UrlAuditField: a pessoa cola o endereço e aperta Auditar. Valida no envio
// (nunca a cada tecla), sem a validação nativa do navegador (`noValidate`). O erro fica ligado
// ao campo (`aria-describedby`: erro e dica, nessa ordem), aparece em `role="alert"` e o foco
// volta ao campo. `aria-invalid` só quando o problema é o endereço.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { t } from "../i18n";
import { Button } from "./Button";
import { Icon } from "./Icon";

export interface UrlFieldError {
  message: string;
  /** O problema é o endereço digitado (`aria-invalid`); falha de rede ou limite não é. */
  invalid: boolean;
}

export interface UrlAuditFieldProps {
  onSubmit: (url: string) => void;
  loading?: boolean;
  /** Erro da API para o último envio; `null` limpa. */
  error?: UrlFieldError | null;
  /** Muda a cada resposta de erro, para o alerta ser anunciado de novo com o mesmo texto. */
  errorKey?: number;
  defaultValue?: string;
}

export function UrlAuditField({ onSubmit, loading, error = null, errorKey = 0, defaultValue = "" }: UrlAuditFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [emptyAttempt, setEmptyAttempt] = useState(0);

  const shown: UrlFieldError | null = emptyAttempt > 0 ? { message: t.urlField.empty, invalid: true } : error;
  const attempt = emptyAttempt > 0 ? -emptyAttempt : errorKey;

  const hasError = shown !== null;

  // Erro novo (vazio ou da API): o foco volta ao campo.
  useEffect(() => {
    if (hasError) inputRef.current?.focus();
  }, [attempt, hasError]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const url = (inputRef.current?.value ?? "").trim();
    if (url === "") {
      setEmptyAttempt((n) => n + 1);
      return;
    }
    setEmptyAttempt(0);
    if (inputRef.current) inputRef.current.value = url;
    onSubmit(url);
  }

  return (
    <form className="rp-url" aria-label={t.urlField.form} noValidate onSubmit={submit}>
      <label htmlFor={inputId} className="rp-url__label">
        {t.urlField.label}
      </label>
      <p id={hintId} className="rp-url__hint">
        {t.urlField.hint}
      </p>
      <div className="rp-url__row">
        <input
          ref={inputRef}
          id={inputId}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          autoCapitalize="none"
          defaultValue={defaultValue}
          className="rp-url__input"
          aria-invalid={shown?.invalid ? true : undefined}
          aria-describedby={shown ? `${errorId} ${hintId}` : hintId}
        />
        <Button type="submit" size="lg" loading={loading} loadingLabel={t.urlField.submitting}>
          {t.urlField.submit}
        </Button>
      </div>
      {shown && (
        <p key={attempt} id={errorId} className="rp-url__error" role="alert">
          <Icon name="critico" />
          <span>
            <span className="rp-sr">{t.state.errorPrefix}</span>{" "}
            {shown.message}
          </span>
        </p>
      )}
    </form>
  );
}
