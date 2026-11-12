import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { axeViolations } from "../../test/render";
import { AppShell } from "../layout/AppShell";
import { RouteErrorPage } from "./RouteErrorPage";

function Broken(): never {
  throw new Error("quebrou");
}

describe("RouteErrorPage", () => {
  it("erro ao montar a tela mantém a moldura, com h1, alerta e caminho de volta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const router = createMemoryRouter(
      [{ element: <AppShell />, children: [{ errorElement: <RouteErrorPage />, children: [{ index: true, element: <Broken /> }] }] }],
      { initialEntries: ["/"] },
    );
    const { container } = render(<RouterProvider router={router} />);
    expect(screen.getByRole("heading", { level: 1, name: "Algo deu errado nesta tela" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Erro: Não conseguimos mostrar esta tela");
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
    expect(screen.getByRole("link", { name: "Voltar para a página inicial" })).toHaveAttribute("href", "/");
    expect(await axeViolations(container)).toEqual([]);
    vi.restoreAllMocks();
  });
});
