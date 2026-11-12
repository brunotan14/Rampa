// Textos da interface em português do Brasil, centralizados (CLAUDE.md, Idioma).
// Tom, microcopy e glossário: design/04-conteudo.md. Nenhum texto afirma que um site "está
// conforme" ou "é acessível" (test/i18n.test.ts confere).
import type { AuditError, KnownErrorCode } from "../api/types";

/** Plural simples do português: 1 → singular; 0 e 2+ → plural. Números no formato pt-BR. */
export function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

const numberFormat = new Intl.NumberFormat("pt-BR");
export const formatNumber = (value: number) => numberFormat.format(value);

/** Códigos com mensagem própria: os da API, os de erro de página/auditoria e os do cliente. */
export type ErrorMessageCode = KnownErrorCode | AuditError["code"];

// Mensagens de erro por `error.code`. A API já manda a `message` pronta em português e ela
// vence; estas valem quando ela falta (resposta sem corpo, proxy fora do ar) e para os erros
// do próprio cliente. O `satisfies` obriga a ter texto para todo código dos contratos.
const errors = {
  // Do cliente
  network_error: "Não conseguimos falar com o Rampa. Confira a sua conexão e tente de novo.",
  unexpected_response: "O Rampa respondeu de um jeito inesperado. Tente de novo em alguns instantes.",
  // Criação da auditoria (RF-RA001, RF-RA002)
  unsupported_scheme: "Só endereços web (http:// ou https://) podem ser auditados.",
  invalid_url:
    "Este endereço não é válido. Confira se ele está completo, sem usuário e senha, e com até 2.048 caracteres.",
  blocked_address: "Este endereço não pode ser auditado. O Rampa só acessa sites públicos, nas portas 80 e 443.",
  unresolvable: "Não encontramos este domínio. Confira se o endereço está certo.",
  dns_error: "Não foi possível verificar este endereço agora. Tente de novo em alguns instantes.",
  invalid_page_limit: "O limite de páginas precisa ser um número inteiro de 1 a 25.",
  invalid_idempotency_key: "Não foi possível enviar o pedido de auditoria. Tente de novo.",
  idempotency_key_reused: "Não foi possível enviar o pedido de auditoria. Tente de novo.",
  idempotency_conflict: "Já existe um pedido igual em andamento. Tente de novo em alguns instantes.",
  invalid_body: "Cole o endereço do site que você quer auditar.",
  rate_limited: "Você atingiu o limite de auditorias por hora. Tente de novo mais tarde.",
  daily_limit_reached: "O limite de auditorias de hoje acabou. Tente de novo amanhã.",
  // Consulta
  audit_not_found: "Auditoria não encontrada. Confira o endereço do relatório.",
  page_not_found: "Esta página não faz parte da auditoria. Volte à lista de páginas.",
  finding_not_found: "Este problema não faz parte da auditoria. Volte à lista de problemas.",
  invalid_filter: "Um dos filtros não é válido. Limpe os filtros e tente de novo.",
  invalid_sort: "Esta ordem não é válida. Escolha outra ordem.",
  invalid_limit: "Não foi possível carregar a lista. Recarregue a página.",
  invalid_cursor: "Não foi possível continuar a lista. Recomece do início.",
  // Canal `audit:<id>`
  channel_limit_reached:
    "Esta conexão já acompanha auditorias demais ao mesmo tempo. Feche outras abas do Rampa e recarregue a página.",
  // Erros de página e de auditoria (`pages.error`, `audits.error`)
  timeout: "A página demorou demais para carregar ou para ser analisada.",
  http_error: "A página respondeu com um erro HTTP e não foi analisada.",
  navigation_failed: "Não foi possível abrir a página.",
  analysis_failed: "A página abriu, mas a análise falhou.",
  resource_limit: "A página passou do limite de dados ou de conexões da análise.",
  unavailable: "O serviço de análise estava indisponível. Tente uma nova auditoria em alguns minutos.",
  invalid_request: "O serviço de análise recusou esta página.",
  invalid_scan_result: "O resultado da análise veio incompleto.",
  contract_mismatch:
    "Não foi possível concluir a análise por uma incompatibilidade interna do Rampa. O problema ficou registrado para a equipe corrigir.",
  stale: "A análise ficou parada por tempo demais e foi encerrada.",
  scan_failed: "A varredura da página falhou, então as análises que dependem dela não rodaram.",
  internal_error: "Ocorreu um erro inesperado. Tente de novo em alguns instantes.",
} as const satisfies Record<ErrorMessageCode, string>;

export const ptBR = {
  app: {
    name: "Rampa",
    homeLink: "Rampa, página inicial",
    skipLink: "Pular para o conteúdo",
    navLabel: "Principal",
    newAudit: "Nova auditoria",
    footer: "Rampa: auditoria de acessibilidade web, em português.",
  },
  home: {
    title: "Seu site, para todo mundo",
    intro:
      "O Rampa está em construção. Em breve você vai colar o endereço do seu site e descobrir o que impede pessoas de usá-lo, e como corrigir.",
    disclaimer:
      "A verificação automática não garante conformidade e não substitui a avaliação com pessoas e tecnologias assistivas.",
  },
  notFound: {
    title: "Página não encontrada",
    text: "O endereço que você abriu não existe no Rampa.",
    back: "Voltar para a página inicial",
  },
  routeError: {
    title: "Algo deu errado nesta tela",
    stateTitle: "Não conseguimos mostrar esta tela",
    text: "Recarregue a página. Se o problema continuar, tente de novo em alguns minutos.",
    back: "Voltar para a página inicial",
  },
  report: {
    // Títulos provisórios das rotas do relatório; as telas entram na `feat/tela-relatorio`.
    titles: {
      audit: "Auditoria",
      pages: "Páginas da auditoria",
      page: "Página da auditoria",
      finding: "Problema da auditoria",
    },
    underConstruction: {
      title: "Esta tela está em construção",
      text: "Em breve o andamento e o relatório desta auditoria vão aparecer aqui. Guarde o endereço desta página para voltar depois.",
      back: "Voltar para a página inicial",
    },
  },
  state: {
    errorPrefix: "Erro:",
    loading: "Carregando…",
    loadingSlow: "Está demorando mais do que o normal. Continuamos tentando; se nada mudar, recarregue a página.",
  },
  link: {
    newTab: "(abre em nova aba)",
  },
  severity: {
    // design/04-conteudo.md, "Severidades: como nomear"
    label: {
      critico: "Crítico",
      serio: "Sério",
      moderado: "Moderado",
      menor: "Menor",
      sucesso: "Aprovado",
      revisao: "Confirme manualmente",
    },
    // Com contagem: "3 críticos", "1 sério", "12 menores".
    count: {
      critico: ["crítico", "críticos"],
      serio: ["sério", "sérios"],
      moderado: ["moderado", "moderados"],
      menor: ["menor", "menores"],
      sucesso: ["aprovado", "aprovados"],
      revisao: ["a confirmar", "a confirmar"],
    },
    description: {
      critico: "Impede alguém de concluir a tarefa.",
      serio: "Dificulta muito; muitas pessoas desistem.",
      moderado: "Atrapalha, mas dá para contornar.",
      menor: "Incômodo ou inconsistência.",
      sucesso: "A verificação passou.",
      revisao: "A IA suspeita de um problema; precisa de olhar humano.",
    },
  },
  errors,
  channel: {
    // RF-RA004: "Auditoria concluída: N problemas em M páginas", uma única vez.
    completed: (problems: number, pages: number, failedPages: number) =>
      `Auditoria concluída: ${plural(problems, "problema", "problemas")} em ${plural(pages, "página", "páginas")}.` +
      (failedPages > 0 ? ` ${plural(failedPages, "página", "páginas")} com falha.` : ""),
    failed: (reason: string | null) => `A auditoria parou.${reason ? ` ${reason}` : ""}`,
    cancelled: "Auditoria cancelada.",
  },
} as const;
