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

// RF-RA005: aviso fixo da tela inicial e do relatório.
const disclaimer =
  "A verificação automática não garante conformidade e não substitui a avaliação com pessoas e tecnologias assistivas.";

// RF-RA028: o mesmo texto no relatório da página e no resumo (uma página).
const loginWall = "Esta página pede login. O Rampa auditou a tela de entrada; áreas logadas ainda não são cobertas.";

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
    disclaimer,
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
      // Os números são os mesmos do percentual (páginas terminadas, com e sem falha).
      milestone: (pct: number, finished: number, found: number, failed: number) =>
        `${formatNumber(pct)}% concluído. ${formatNumber(finished)} de ${plural(found, "página verificada", "páginas verificadas")}` +
        (failed > 0 ? `, ${formatNumber(failed)} com falha.` : "."),
      leaveHint: "Você pode sair desta página e voltar pelo mesmo endereço: a auditoria continua.",
      failedFallback: "Não conseguimos continuar a auditoria.",
    },
    connection: {
      connecting: "Conectando ao andamento ao vivo…",
      open: "Ao vivo",
      reconnecting: "Sem conexão. Tentando reconectar; os números podem estar atrasados.",
      // Join recusado (ex.: `channel_limit_reached`): o resumo é buscado a cada 30 s.
      offlineTitle: "Sem atualização ao vivo",
      offlineText: "Os números são atualizados a cada 30 segundos.",
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
  // Relatório (RF-RA005, RF-RA006, RF-RA007, RF-RA017, RF-RA028, RF-RA029). O que vem do axe
  // (`help`, `message`) ainda é em inglês no M2 e aparece marcado com `lang="en"`.
  report: {
    disclaimer,
    crumbs: {
      label: "Você está em",
      report: (host: string) => `Relatório de ${host}`,
      reportNoHost: "Relatório da auditoria",
      pages: "Páginas",
      finding: "Problema",
    },
    loginWall: {
      one: loginWall,
      many: (pages: number) =>
        `${plural(pages, "página pede", "páginas pedem")} login. O Rampa auditou as telas de entrada; áreas logadas ainda não são cobertas.`,
      badge: "Pede login",
    },
    // RF-RA029: nova auditoria da mesma URL, com chave de idempotência nova.
    again: "Auditar de novo",
    againLoading: "Iniciando…",
    running: "A auditoria ainda está em andamento: o que aparece aqui pode mudar.",
    follow: "Acompanhar o andamento",
    criterion: (id: string) => `WCAG ${id}`,
    noCriteria: "Sem critério WCAG associado",
    sources: {
      axe: "Verificação automática (axe-core)",
      ai: "Avaliação por IA",
      heuristic: "Heurística do Rampa",
    },
    ai: {
      label: "Avaliado por IA, confirme manualmente",
      confidence: { alta: "Confiança alta", media: "Confiança média", baixa: "Confiança baixa" },
    },
    axeUndecided: "O axe não conseguiu decidir: confirme manualmente",
    pageStatus: {
      queued: "Na fila",
      scanning: "Em análise",
      analyzing: "Em análise",
      done: "Analisada",
      failed: "Com falha",
    },
    summary: {
      title: (host: string) => `Relatório de ${host}`,
      titleNoHost: "Relatório da auditoria",
      meta: (when: string, pages: string) => `Auditado ${when} · ${pages} · WCAG 2.2 nível AA`,
      loading: "Carregando o relatório…",
      viewPages: "Ver páginas e problemas",
      stats: {
        problems: "Problemas confirmados",
        critical: "Críticos",
        review: "Para confirmar",
        pages: "Páginas analisadas",
        failed: "Páginas com falha",
      },
      scoreText:
        "Conta só os problemas que a verificação automática confirmou; os que pedem confirmação manual ficam de fora.",
      severity: {
        title: "Problemas por severidade",
        barLabel: "Problemas por severidade, com os que pedem confirmação",
        caption: "Problemas confirmados e para confirmar, por severidade",
        severity: "Severidade",
        auto: "Confirmados automaticamente",
        review: "Pedem confirmação manual",
        total: "Total",
      },
      top: {
        title: "Os problemas mais frequentes",
        note: "Até 5 problemas confirmados, dos que aparecem em mais páginas para os que aparecem em menos.",
        rank: (n: number) => `${n}º: `,
        pages: (n: number) => `Em ${plural(n, "página", "páginas")}`,
        occurrences: (n: number) => plural(n, "ocorrência", "ocorrências"),
        details: "Ver detalhes",
        detailsOf: "do problema",
        all: "Ver todos os problemas por página",
        emptyTitle: "A verificação automática não confirmou problemas",
        emptyText:
          "Isso não quer dizer que o site não tenha barreiras: confira os achados para confirmar e faça a avaliação com pessoas e tecnologias assistivas.",
      },
      review: {
        title: "Achados que pedem confirmação",
        text: (n: number) =>
          n === 1
            ? "1 achado pede confirmação manual: a verificação automática não conseguiu decidir sozinha. Ele não conta entre os problemas confirmados."
            : `${formatNumber(n)} achados pedem confirmação manual: a verificação automática não conseguiu decidir sozinha. Eles não contam entre os problemas confirmados.`,
        link: "Ver as páginas com achados para confirmar",
      },
    },
    pages: {
      title: (host: string) => `Páginas auditadas em ${host}`,
      titleNoHost: "Páginas auditadas",
      loadingTitle: "Carregando as páginas",
      loading: "Carregando as páginas…",
      filtersLabel: "Filtrar e ordenar as páginas",
      severity: "Severidade",
      severityAll: "Todas as severidades",
      severityOption: {
        critico: "Com problemas críticos",
        serio: "Com problemas sérios",
        moderado: "Com problemas moderados",
        menor: "Com problemas menores",
      },
      review: "Confirmação manual",
      reviewAll: "Todas as páginas",
      reviewYes: "Só as com achados para confirmar",
      order: "Ordenar por",
      orders: {
        gravidade: "Mais graves primeiro",
        endereco: "Endereço, de A a Z",
        status: "Status, com falha primeiro",
      },
      count: (shown: number, total: number) => `${formatNumber(shown)} de ${plural(total, "página", "páginas")}`,
      listLabel: "Páginas da auditoria",
      noProblems: "Sem problemas confirmados",
      emptyTitle: "Nenhuma página nesta auditoria ainda",
      emptyText: "As páginas aparecem aqui quando a varredura começa.",
      emptyFilterTitle: "Nenhuma página com esses filtros",
      emptyFilterText: "Mude ou limpe os filtros para ver as outras páginas.",
      clear: "Limpar filtros",
    },
    page: {
      loadingTitle: "Carregando a página da auditoria",
      loading: "Carregando a página…",
      notFoundTitle: "Página não encontrada na auditoria",
      notFoundState: "Não encontramos esta página na auditoria",
      backToPages: "Voltar para as páginas",
      scannedAt: (when: string) => `Analisada ${when}`,
      redirected: "Redirecionada para",
      failedTitle: "Esta página não foi analisada",
      pendingTitle: "Esta página ainda está em análise",
      pendingText: "Volte daqui a pouco ou acompanhe o andamento da auditoria.",
      noProblems: "Sem problemas confirmados pela verificação automática",
      barLabel: "Problemas desta página por severidade",
      tabsLabel: "Resultados desta página",
      tabs: { problems: "Problemas", passed: "Aprovados" },
      filters: {
        label: "Filtrar os problemas",
        severity: "Severidade",
        all: "Todas",
        source: "Origem",
        wcag: "Critério WCAG",
        wcagHint: "Só o número, como 1.4.3.",
        wcagInvalid: "Escreva o critério só com o número, como 1.4.3.",
        review: "Confirmação manual",
        reviewAll: "Todos",
        reviewYes: "Só os que pedem confirmação",
        reviewNo: "Só os confirmados",
        apply: "Filtrar",
        clear: "Limpar filtros",
      },
      count: (n: number, filtered: boolean) =>
        filtered ? `${plural(n, "problema", "problemas")} com estes filtros.` : `${plural(n, "problema", "problemas")}.`,
      showing: (shown: number, total: number) =>
        `Mostrando ${formatNumber(shown)} de ${formatNumber(total)}, dos mais graves para os menos graves.`,
      more: "Mostrar mais problemas",
      moreLoading: "Carregando…",
      loadingFindings: "Carregando os problemas…",
      emptyTitle: "Nenhum problema nesta página",
      emptyText: "A verificação automática não apontou problemas aqui. Isso não garante que a página não tenha barreiras.",
      emptyFilterTitle: "Nenhum problema com esses filtros",
      emptyFilterText: "Mude ou limpe os filtros para ver os outros problemas desta página.",
      loadErrorTitle: "Não conseguimos carregar os problemas",
      retry: "Tentar de novo",
    },
    group: {
      rule: "Regra",
      criteria: "Critérios",
      source: "Origem",
      elements: (n: number) => `Elementos afetados (${formatNumber(n)})`,
      elementPrefix: "Ver o problema no elemento",
      noSelector: "Elemento sem seletor",
    },
    passed: {
      intro: (n: number) =>
        `${plural(n, "regra", "regras")} da verificação automática ${n === 1 ? "passou" : "passaram"} nesta página. "Aprovado" vale para cada regra, não para a página inteira.`,
      listLabel: "Regras aprovadas",
      nodes: (n: number) => `Em ${plural(n, "elemento", "elementos")}`,
      notCollectedTitle: "As verificações aprovadas não foram coletadas",
      notCollectedText: "Isso acontece quando a página não foi analisada ou foi analisada por uma versão anterior do Rampa.",
      noneTitle: "Nenhuma regra passou nesta página",
      noneText: "A verificação automática não encontrou regras aprovadas aqui.",
    },
    finding: {
      loadingTitle: "Carregando o problema",
      loading: "Carregando o problema…",
      notFoundTitle: "Problema não encontrado na auditoria",
      notFoundState: "Não encontramos este problema na auditoria",
      ruleTitle: (rule: string) => `Regra ${rule}`,
      stats: { page: "Nesta página", audit: "Na auditoria", times: (n: number) => (n === 1 ? "vez" : "vezes") },
      code: "Código encontrado",
      noCode: "O trecho de código deste elemento não foi guardado.",
      ai: {
        title: "Avaliação da IA",
        reason: "Por que a IA suspeita",
        suggestion: "Sugestão da IA",
      },
      who: "Quem é afetado",
      fix: "Como corrigir",
      axeSays: "O que o axe-core diz, em inglês:",
      docs: (rule: string) => `Regra ${rule} na documentação do axe-core (em inglês)`,
      aside: "Detalhes do problema",
      details: "Detalhes",
      severity: "Severidade",
      criteria: "Critérios",
      source: "Verificação",
      element: "Elemento",
      page: "Página",
      sourceAxe: (version: string | null, rule: string) =>
        `Automática (axe-core${version ? ` ${version}` : ""}, regra ${rule})`,
      sourceAi: (model: string | null) => `Avaliação por IA${model ? ` (${model})` : ""}`,
      sourceHeuristic: "Heurística do Rampa",
      elsewhere: "Onde mais aparece",
      elsewhereTimes: (n: number) => plural(n, "vez", "vezes"),
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
