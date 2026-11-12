// Contagem até o valor (design/06-movimento.md, "Contagem"). O leitor de tela nunca ouve o
// meio da animação: o número que conta fica em `aria-hidden` e o valor final em texto oculto.
// Com movimento reduzido (ou sem `matchMedia`), mostra o valor final direto.
import { useEffect, useRef, useState } from "react";
import { formatNumber } from "../i18n";
import { COUNT_MS, useMotionAllowed } from "../motion";

export function CountUp({ value, duration = COUNT_MS }: { value: number; duration?: number }) {
  const motion = useMotionAllowed();
  // O número na tela; enquanto a animação não começa, continua o anterior.
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const origin = shownRef.current;
    const show = (n: number) => {
      shownRef.current = n;
      setShown(n);
    };
    if (!motion || origin === value) {
      shownRef.current = value;
      return;
    }
    const start = performance.now();
    let id = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3; // desacelera no fim
      show(progress < 1 ? Math.round(origin + (value - origin) * eased) : value);
      if (progress < 1) id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [value, duration, motion]);

  const display = motion ? shown : value;
  if (display === value) return <>{formatNumber(value)}</>;
  return (
    <>
      <span aria-hidden="true">{formatNumber(display)}</span>
      <span className="rp-sr">{formatNumber(value)}</span>
    </>
  );
}
