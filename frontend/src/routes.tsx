import type { RouteObject } from "react-router";
import { AppShell } from "./layout/AppShell";
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
          { index: true, element: <HomePage /> },
          { path: "auditorias/:id", element: <AuditPlaceholderPage view="audit" /> },
          { path: "auditorias/:id/paginas", element: <AuditPlaceholderPage view="pages" /> },
          { path: "auditorias/:id/paginas/:pageId", element: <AuditPlaceholderPage view="page" /> },
          { path: "auditorias/:id/problemas/:findingId", element: <AuditPlaceholderPage view="finding" /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
