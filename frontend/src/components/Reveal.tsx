// Revelar ao rolar (design/06-movimento.md, "Reveal"): o conteúdo sobe e aparece uma vez, ao
// entrar na tela. Só com movimento permitido e com `IntersectionObserver`; sem eles (ou na
// impressão) o conteúdo já está visível, sem perda.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMotionAllowed } from "../motion";

export interface RevealProps {
  as?: "div" | "section" | "li";
  /** Atraso da entrada, em múltiplos de `duration-fast` (cascata do top 5). */
  step?: number;
  className?: string;
  children: ReactNode;
  "aria-labelledby"?: string;
}

export function Reveal({ as: Tag = "div", step = 0, className, children, ...aria }: RevealProps) {
  const motion = useMotionAllowed();
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  const observable = motion && typeof IntersectionObserver !== "undefined";

  useEffect(() => {
    const element = ref.current;
    if (!observable || element === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShown(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [observable]);

  const classes = [className, observable && "rp-reveal", observable && shown && "is-in"].filter(Boolean).join(" ");
  const style = step > 0 ? ({ "--rp-step": step } as CSSProperties) : undefined;
  return (
    <Tag ref={ref as never} className={classes || undefined} style={style} {...aria}>
      {children}
    </Tag>
  );
}
