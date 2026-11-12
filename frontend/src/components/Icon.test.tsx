import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("sem rótulo é decorativo e não recebe foco", () => {
    const { container } = render(<Icon name="critico" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).not.toHaveAttribute("role");
  });

  it("com rótulo é uma imagem com nome", () => {
    render(<Icon name="relogio" label="Em andamento" />);
    expect(screen.getByRole("img", { name: "Em andamento" })).toBeInTheDocument();
  });

  it("cada severidade tem forma própria", () => {
    const shapes = (["critico", "serio", "moderado", "menor", "sucesso", "revisao"] as const).map(
      (name) => render(<Icon name={name} />).container.querySelector("svg")!.innerHTML,
    );
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("tamanho pequeno usa a classe de 16px", () => {
    const { container } = render(<Icon name="info" size="sm" />);
    expect(container.querySelector("svg")).toHaveClass("rp-icon", "rp-icon--sm");
  });
});
