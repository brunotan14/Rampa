import { screen } from "@testing-library/react";
import { axeViolations, renderRoute } from "../test/render";

const AUDIT = "3f2b8c1e-7a4d-4e5f-9b0c-1d2e3f4a5b6c";
const PAGE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("rotas", () => {
  it.each([
    [`/auditorias/${AUDIT}`, "Auditoria"],
    [`/auditorias/${AUDIT}/paginas`, "Páginas da auditoria"],
    [`/auditorias/${AUDIT}/paginas/${PAGE}`, "Página da auditoria"],
    [`/auditorias/${AUDIT}/problemas/${PAGE}`, "Problema da auditoria"],
  ])("%s mostra o aviso de tela em construção, com h1 igual ao título", async (path, title) => {
    const { container } = renderRoute(path);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(document.title).toBe(`${title} – Rampa`);
    expect(screen.getByRole("region", { name: "Esta tela está em construção" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Esta tela está em construção" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar para a página inicial" })).toHaveAttribute("href", "/");
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([
    "/auditorias/nao-e-uuid",
    `/auditorias/${AUDIT.toUpperCase()}`,
    `/auditorias/${AUDIT}/paginas/123`,
    `/auditorias/${AUDIT}/outra-coisa`,
    "/qualquer/coisa",
  ])("%s é página não encontrada", async (path) => {
    const { container } = renderRoute(path);
    expect(screen.getByRole("heading", { level: 1, name: "Página não encontrada" })).toBeInTheDocument();
    expect(document.title).toBe("Página não encontrada – Rampa");
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
    expect(await axeViolations(container)).toEqual([]);
  });
});
