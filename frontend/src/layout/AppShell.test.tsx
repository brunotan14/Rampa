import { act, screen, waitFor, within } from "@testing-library/react";
import { axeViolations, renderRoute } from "../../test/render";

const AUDIT = "/auditorias/3f2b8c1e-7a4d-4e5f-9b0c-1d2e3f4a5b6c";

describe("AppShell", () => {
  it("começa pelo link de pular para o conteúdo, que aponta para o main", () => {
    renderRoute("/");
    const skip = screen.getByRole("link", { name: "Pular para o conteúdo" });
    expect(skip).toHaveAttribute("href", "#conteudo");
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(document.body.querySelector("a")).toBe(skip);
  });

  it("tem os marcos de cabeçalho, navegação principal, principal e rodapé", () => {
    renderRoute("/");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("o logo é o link para a página inicial, com nome acessível", () => {
    renderRoute("/");
    const home = screen.getByRole("link", { name: "Rampa, página inicial" });
    expect(home).toHaveAttribute("href", "/");
    expect(within(home).getByRole("img", { name: "Rampa, página inicial" })).toBeInTheDocument();
  });

  it("marca Nova auditoria como página atual só na tela inicial", async () => {
    const { router } = renderRoute("/");
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Nova auditoria" })).toHaveAttribute("aria-current", "page");
    await act(() => router.navigate(AUDIT));
    expect(within(nav).getByRole("link", { name: "Nova auditoria" })).not.toHaveAttribute("aria-current");
  });

  it("não tem funções pós-MVP (Entrar, Planos, Histórico)", () => {
    renderRoute("/");
    const banner = screen.getByRole("banner");
    for (const name of [/entrar/i, /planos/i, /histórico/i, /sites/i]) {
      expect(within(banner).queryByRole("link", { name })).toBeNull();
      expect(within(banner).queryByRole("button", { name })).toBeNull();
    }
  });

  it("ao trocar de rota, leva o foco ao h1 e atualiza o título do documento", async () => {
    const { router } = renderRoute("/");
    await act(() => router.navigate("/nao-existe"));
    const h1 = screen.getByRole("heading", { level: 1, name: "Página não encontrada" });
    await waitFor(() => expect(h1).toHaveFocus());
    expect(document.title).toBe("Página não encontrada – Rampa");
  });

  it("na primeira carga não move o foco", () => {
    renderRoute("/");
    expect(document.body).toHaveFocus();
  });

  it("no StrictMode (efeito executado duas vezes) também não move o foco na primeira carga", async () => {
    const { router } = renderRoute(AUDIT, { strict: true });
    expect(document.body).toHaveFocus();
    await act(() => router.navigate("/"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
  });

  it("não tem violações do axe", async () => {
    const { container } = renderRoute("/");
    expect(await axeViolations(container)).toEqual([]);
  });
});
