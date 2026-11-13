// Trecho de código do elemento afetado (design/components/IssueCard, "Código encontrado").
// Quebra as linhas longas (`pre-wrap`): nada de rolagem horizontal em 320px. O título da seção
// em volta diz o que é; o código vem da página auditada e é mostrado como texto, nunca como HTML.
export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="rp-codeblock">
      <code>{code}</code>
    </pre>
  );
}
