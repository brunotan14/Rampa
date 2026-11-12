import type { RouteObject } from "react-router";
import { AppShell, type RouteHandle } from "./layout/AppShell";
import { AuditPage } from "./pages/AuditPage";
import { AuditPlaceholderPage } from "./pages/AuditPlaceholderPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
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
          // Progresso enquanto a auditoria anda; relatório (ainda em construção) depois.
          { path: "auditorias/:id", element: <AuditPage /> },
          { path: "auditorias/:id/paginas", element: <AuditPlaceholderPage view="pages" /> },
          { path: "auditorias/:id/paginas/:pageId", element: <AuditPlaceholderPage view="page" /> },
          { path: "auditorias/:id/problemas/:findingId", element: <AuditPlaceholderPage view="finding" /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
