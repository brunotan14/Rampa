// Ponto de entrada dos textos da interface. Hoje só há português do Brasil; outro idioma
// entra como outro arquivo com a mesma forma de `ptBR`.
import { ptBR } from "./pt-BR";

export {
  formatAt,
  formatDate,
  formatFrom,
  formatNumber,
  formatTime,
  formatTimeWithSeconds,
  plural,
  type ErrorMessageCode,
} from "./pt-BR";

export const t = ptBR;

/** `<title>` do documento: igual ao `h1` da tela, seguido do nome do produto. */
export const documentTitle = (page: string) => (page === t.app.name ? page : `${page} – ${t.app.name}`);

/** Mensagem de um `error.code`, com a genérica para código que o cliente não conhece. */
export function errorMessage(code: string): string {
  return Object.hasOwn(t.errors, code) ? t.errors[code as keyof typeof t.errors] : t.errors.internal_error;
}
