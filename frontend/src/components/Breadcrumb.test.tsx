import { screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { render } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { Breadcrumb } from "./Breadcrumb";

describe("Breadcrumb", () => {
  it("é uma navegação 'Você está em' com links e o item atual em texto", async () => {
    const router = createMemoryRouter(
      [{ path: "*", element: <Breadcrumb items={[{ label: "Relatório", href: "/r" }, { label: "Páginas" }]} /> }],
    );
    const { container } = render(<RouterProvider router={router} />);
    const nav = screen.getByRole("navigation", { name: "Você está em" });
    expect(nav.querySelector("ol")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Relatório" })).toHaveAttribute("href", "/r");
    expect(screen.getByText("Páginas")).toHaveAttribute("aria-current", "page");
    expect(await axeViolations(container)).toEqual([]);
  });
});
