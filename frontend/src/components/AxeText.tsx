// Texto que vem do axe-core (`help`, `message`, regras aprovadas). No M2 ele é em inglês; o
// `lang="en"` faz o leitor de tela trocar a pronúncia. As traduções em PT-BR entram no M3 (PRD
// §12), e aí este é o único lugar a mudar.
export function AxeText({ children, className }: { children: string; className?: string }) {
  return (
    <span lang="en" className={className}>
      {children}
    </span>
  );
}
