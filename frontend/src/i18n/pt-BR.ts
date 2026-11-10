// Textos da interface, centralizados (CLAUDE.md, Idioma). Tom e glossário: design/04-conteudo.md.
export const t = {
  app: {
    name: "Rampa",
    homeLink: "Rampa, página inicial",
    skipLink: "Pular para o conteúdo",
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
} as const;

export const documentTitle = (page: string) => (page === t.app.name ? page : `${page} – ${t.app.name}`);
