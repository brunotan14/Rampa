import type { RouteObject } from "react-router";
import { AppShell, type RouteHandle } from "./layout/AppShell";
import { ReportLayout } from "./layout/ReportLayout";
import { AuditPage } from "./pages/AuditPage";
import { FindingPage } from "./pages/FindingPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PageReportPage } from "./pages/PageReportPage";
import { PagesPage } from "./pages/PagesPage";
import { RouteErrorPage } from "./pages/RouteErrorPage";

// O id da auditoria no endereço é o link do relatório (RF-RA014). As páginas e os problemas
// ficam sob a auditoria, como na API (`/api/audits/:id/pages/:page_id`).
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      {
        errorElement: <RouteErrorPage />,
        children: [
          // A faixa da tela inicial vai de ponta a ponta (TelaInicial).
          { index: true, element: <HomePage />, handle: { fullBleed: true } satisfies RouteHandle },
          // Progresso enquanto a auditoria anda; relatório resumido depois.
          // Todas sob o `ReportLayout`, que busca antes o catálogo dos critérios WCAG.
          {
            path: "auditorias/:id",
            element: <ReportLayout />,
            children: [
              { index: true, element: <AuditPage /> },
              { path: "paginas", element: <PagesPage /> },
              { path: "paginas/:pageId", element: <PageReportPage /> },
              { path: "problemas/:findingId", element: <FindingPage /> },
            ],
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
