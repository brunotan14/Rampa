import { act, screen, waitFor } from "@testing-library/react";
import { axeViolations, renderRoute } from "../../test/render";

describe("AppLayout", () => {
  it("começa pelo link de pular para o conteúdo, que aponta para o main", () => {
    renderRoute("/");
    const skip = screen.getByRole("link", { name: "Pular para o conteúdo" });
    expect(skip).toHaveAttribute("href", "#conteudo");
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
    expect(document.body.querySelector("a")).toBe(skip);
  });

  it("tem os marcos de cabeçalho, principal e rodapé", () => {
    renderRoute("/");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("o logo é o link para a página inicial, com nome acessível", () => {
    renderRoute("/");
    expect(screen.getByRole("link", { name: "Rampa, página inicial" })).toHaveAttribute("href", "/");
  });

  it("ao trocar de rota, leva o foco ao h1 e atualiza o título do documento", async () => {
    const { router } = renderRoute("/");
    await act(() => router.navigate("/nao-existe"));
    const h1 = screen.getByRole("heading", { level: 1, name: "Página não encontrada" });
    await waitFor(() => expect(h1).toHaveFocus());
    expect(document.title).toBe("Página não encontrada – Rampa");
  });

  it("não tem violações do axe", async () => {
    const { container } = renderRoute("/");
    expect(await axeViolations(container)).toEqual([]);
  });
});
