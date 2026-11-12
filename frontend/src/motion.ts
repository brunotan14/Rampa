// Movimento (design/06-movimento.md): tudo só sob `prefers-reduced-motion: no-preference`.
// Sem `matchMedia` (jsdom, navegador antigo), vale como movimento reduzido: a tela aparece
// pronta, com os valores finais.
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: no-preference)";

/** Duração da contagem dos contadores ao vivo (TelaVarredura: "contam até o novo valor"). */
export const COUNT_MS = 450;

function media(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
}

function subscribe(onChange: () => void) {
  const list = media();
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

/** `true` quando a pessoa não pediu movimento reduzido. Reage à troca da preferência. */
export function useMotionAllowed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}
