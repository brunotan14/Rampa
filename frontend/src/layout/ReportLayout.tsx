// Rotas de uma auditoria (`/auditorias/:id/**`): só passa adiante, buscando antes o catálogo dos
// critérios WCAG. Assim o detalhe de um problema aberto por link direto já o encontra no cache
// (FR-017) e as listas mostram número e título desde o começo. Endereço com id inválido vira
// "Página não encontrada" na própria tela, sem buscar nada.
import { Outlet, useParams } from "react-router";
import { usePrefetchWcagCriteria } from "../api/hooks";
import { isAuditId } from "../report";

export function ReportLayout() {
  const { id } = useParams();
  usePrefetchWcagCriteria(isAuditId(id));
  return <Outlet />;
}
