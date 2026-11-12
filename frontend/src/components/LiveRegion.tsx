// A única região viva de uma tela (`role="status"`, educada, atômica). Montada vazia desde o
// primeiro quadro da tela: região inserida já com o texto não é anunciada por vários leitores
// de tela (design/05-implementacao.md). O texto só muda nos marcos e no fim.
export function LiveRegion({ text }: { text: string }) {
  return (
    <div className="rp-sr" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
