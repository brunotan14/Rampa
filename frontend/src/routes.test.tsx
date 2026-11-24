import { act, screen } from "@testing-library/react";
import { stubApi } from "../test/api";
import { FakeSocket } from "../test/fakeSocket";
import { WCAG_CRITERIA_PATH, auditSummary, wcagCatalog } from "../test/fixtures";
import { axeViolations, renderRoute } from "../test/render";

const AUDIT = "3f2b8c1e-7a4d-4e5f-9b0c-1d2e3f4a5b6c";
const PAGE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("rotas", () => {
  it.each([
    "/auditorias/nao-e-uuid",
    `/auditorias/${AUDIT.toUpperCase()}`,
    `/auditorias/${AUDIT}/paginas/123`,
    `/auditorias/${AUDIT}/problemas/${PAGE.toUpperCase()}`,
    `/auditorias/${AUDIT}/outra-coisa`,
    "/qualquer/coisa",
  ])("%s é página não encontrada", async (path) => {
    const { container } = renderRoute(path);
    expect(screen.getByRole("heading", { level: 1, name: "Página não encontrada" })).toBeInTheDocument();
    expect(document.title).toBe("Página não encontrada – Rampa");
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([`/auditorias/${AUDIT}`, `/auditorias/${AUDIT}/paginas`, `/auditorias/${AUDIT}/paginas/${PAGE}`])(
    "FR-017: %s busca o catálogo dos critérios WCAG logo ao abrir, uma vez",
    async (path) => {
      const api = stubApi({
        [`/api/audits/${AUDIT}`]: auditSummary({ status: "completed" }),
        [`/api/audits/${AUDIT}/pages`]: { data: [] },
        [WCAG_CRITERIA_PATH]: wcagCatalog(),
      });
      // Socket falso: o de verdade tentaria reconectar depois do fim do teste.
      const { client } = renderRoute(path, { socket: new FakeSocket() });
      await vi.waitFor(() => expect(client.getQueryData(["wcag-criteria"])).toBeDefined());
      expect(api.calls(WCAG_CRITERIA_PATH)).toHaveLength(1);
      vi.unstubAllGlobals();
    },
  );

  it.each(["/", "/auditorias/nao-e-uuid"])("%s não busca o catálogo", async (path) => {
    const api = stubApi({});
    renderRoute(path, { socket: new FakeSocket() });
    await act(async () => {});
    expect(api.calls(WCAG_CRITERIA_PATH)).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
