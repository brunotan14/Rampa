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

// Datas e horas no fuso de quem usa (04-conteudo.md: `10/11/2026`, `14:32`).
const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const timeSecondsFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export const formatTime = (date: Date) => timeFormat.format(date);
export const formatTimeWithSeconds = (date: Date) => timeSecondsFormat.format(date);
export const formatDate = (date: Date) => dateFormat.format(date);

const sameDay = (a: Date, b: Date) => formatDate(a) === formatDate(b);

/** "das 14:32" no mesmo dia; "de 13/11/2026, às 00:00" em outro dia. */
export function formatFrom(date: Date, now: Date = new Date()): string {
  return sameDay(date, now) ? `das ${formatTime(date)}` : `de ${formatDate(date)}, às ${formatTime(date)}`;
}

/** "às 14:00" no mesmo dia; "em 12/11/2026, às 14:00" em outro dia. */
export function formatAt(date: Date, now: Date = new Date()): string {
  return sameDay(date, now) ? `às ${formatTime(date)}` : `em ${formatDate(date)}, às ${formatTime(date)}`;
}

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
    // O h1 é igual ao <title>; o trecho em destaque é só visual (cor do cerrado).
    title: "Seu site, para todo mundo",
    titleEmphasis: "todo mundo",
    pill: "Auditoria de acessibilidade em português",
    lead: "Cole o endereço. Em poucos minutos você sabe o que impede pessoas de usar o seu site e como corrigir.",
    trustLabel: "O que vem em toda auditoria",
    trust: ["Critérios da WCAG 2.2 nível AA", "Verificação automática com o axe-core", "Relatório em português"],
    howTitle: "Como funciona",
    how: [
      {
        title: "Cole o endereço",
        text: "O Rampa abre a página num navegador de verdade, como uma pessoa faria. Por enquanto, analisamos só a página do endereço informado.",
      },
      {
        title: "A gente verifica",
        text: "O axe-core confere as regras automáticas da WCAG 2.2 nível AA e aponta onde cada problema aparece.",
      },
      {
        title: "Você corrige",
        text: "Cada problema vem com a regra, o critério da WCAG e o trecho de código onde ele está.",
      },
    ],
    // "Um relatório que todo mundo entende" (TelaInicial): exemplo com dados fictícios.
    example: {
      title: "Um relatório que todo mundo entende",
      note: "Exemplo com dados fictícios.",
      score: 72,
      scoreText: "Para quem decide: uma nota, o que ela significa e o que fazer primeiro.",
      summaryTitle: "47 problemas em 56 páginas",
      barLabel: "Problemas por severidade no exemplo",
      counts: { critico: 5, serio: 8, moderado: 11, menor: 12, revisao: 11 },
    },
    disclaimer:
      "A verificação automática não garante conformidade e não substitui a avaliação com pessoas e tecnologias assistivas.",
  },
  // design/components/ScoreIndicator (PRD §10.6: sempre com este rótulo; nunca "nota de
  // acessibilidade" nem "conformidade").
  score: {
    label: "Indicador de problemas encontrados automaticamente",
    outOf: "de 100",
    bands: {
      excelente: "Excelente",
      bom: "Bom",
      atencao: "Precisa de atenção",
      graves: "Barreiras graves",
    },
  },
  // design/components/UrlAuditField
  urlField: {
    form: "Nova auditoria",
    label: "Endereço do site",
    hint: "Ex.: exemplo.com.br. Por enquanto, o Rampa analisa só a página deste endereço.",
    submit: "Auditar",
    submitting: "Iniciando…",
    empty: "Cole o endereço do site que você quer auditar.",
    // 429 com `retry_after`: o horário vai no fuso de quem usa (`formatFrom`).
    rateLimited: (from: string) => `Você atingiu o limite de auditorias por hora. Tente de novo a partir ${from}.`,
    dailyLimitReached: (from: string) => `O limite de auditorias de hoje acabou. Tente de novo a partir ${from}.`,
  },
  audit: {
    loadingTitle: "Carregando auditoria",
    loading: "Carregando a auditoria…",
    // h1 da tela de progresso (TelaVarredura), com o host quando já se sabe.
    title: {
      running: (host: string) => `Auditando ${host}`,
      completed: (host: string) => `Auditoria de ${host} concluída`,
      failed: (host: string) => `A auditoria de ${host} parou`,
      cancelled: (host: string) => `Auditoria de ${host} cancelada`,
    },
    titleNoHost: {
      running: "Auditoria em andamento",
      completed: "Auditoria concluída",
      failed: "A auditoria parou",
      cancelled: "Auditoria cancelada",
    },
    started: (when: string, pages: string) => `Iniciada ${when} · WCAG 2.2 nível AA · até ${pages}`,
    notFoundTitle: "Auditoria não encontrada",
    notFoundState: "Não encontramos esta auditoria",
    loadErrorTitle: "Não conseguimos carregar a auditoria",
    retry: "Tentar de novo",
    newAudit: "Fazer uma nova auditoria",
    viewReport: "Ver relatório",
    steps: {
      label: "Etapas da auditoria",
      // No M2 a etapa vem do `status` (PRD §9); a análise de IA entra no M4.
      items: ["Na fila", "Varredura automática", "Relatório"],
      state: { done: "concluída", current: "em andamento", pending: "pendente", stopped: "interrompida" },
    },
    // design/components/ScanProgress
    scan: {
      title: {
        queued: "Na fila para começar",
        discovering: "Procurando páginas…",
        running: "Analisando o site…",
        done: "Varredura concluída",
        failed: "A varredura parou",
        cancelled: "Varredura cancelada",
      },
      progressIndeterminate: "Procurando páginas, total ainda desconhecido",
      progressValue: (pct: number, finished: number, found: number) =>
        `${formatNumber(pct)}%, ${formatNumber(finished)} de ${plural(found, "página verificada", "páginas verificadas")}`,
      statsLabel: "Páginas",
      found: "Encontradas",
      scanned: "Analisadas",
      failed: "Com falha",
      // 04-conteudo.md, "Anúncios para leitor de tela": a cada 25%, no máximo uma vez a cada 10 s.
      milestone: (pct: number, scanned: number, found: number) =>
        `${formatNumber(pct)}% concluído. ${formatNumber(scanned)} de ${plural(found, "página analisada", "páginas analisadas")}.`,
      leaveHint: "Você pode sair desta página e voltar pelo mesmo endereço: a auditoria continua.",
      failedFallback: "Não conseguimos continuar a auditoria.",
    },
    connection: {
      connecting: "Conectando ao andamento ao vivo…",
      open: "Ao vivo",
      reconnecting: "Sem conexão. Tentando reconectar; os números podem estar atrasados.",
    },
    findings: {
      titleRunning: "Problemas encontrados até agora",
      titleDone: "Problemas encontrados",
      note: "Só os problemas que a verificação automática confirmou. Os números mudam até o fim da varredura.",
      noteDone: "Só os problemas que a verificação automática confirmou.",
    },
    // design/components/ActivityFeed
    feed: {
      title: "Atividade",
      empty: "Esperando a primeira página…",
      page: "Página",
      scanned: (problems: number) => `analisada: ${plural(problems, "problema", "problemas")}`,
      failed: (reason: string) => `com falha. ${reason}`,
    },
    report: {
      title: (host: string) => `Relatório de ${host}`,
      titleNoHost: "Relatório da auditoria",
      stateTitle: "O relatório está em construção",
      summary: (problems: number, pages: number) =>
        `A auditoria terminou: ${plural(problems, "problema", "problemas")} em ${plural(pages, "página", "páginas")}.`,
      text: "Em breve o relatório completo vai aparecer aqui. Guarde o endereço desta página para voltar depois.",
    },
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
      pages: "Páginas da auditoria",
      page: "Página da auditoria",
      finding: "Problema da auditoria",
    },
    underConstruction: {
      title: "Esta tela está em construção",
      text: "Em breve esta parte do relatório vai aparecer aqui. Guarde o endereço desta página para voltar depois.",
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
    // Cabeçalho de contagem (cards da tela de progresso).
    plural: {
      critico: "Críticos",
      serio: "Sérios",
      moderado: "Moderados",
      menor: "Menores",
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
