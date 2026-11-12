import { render, screen } from "@testing-library/react";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("é uma imagem com o nome Rampa por padrão", () => {
    render(<Logo />);
    const img = screen.getByRole("img", { name: "Rampa" });
    expect(img).toHaveAttribute("height", "32");
    expect(img).toHaveAttribute("width", "124");
  });

  it("aceita outro nome e a variante só símbolo, quadrada", () => {
    render(<Logo variant="simbolo" height={48} title="Rampa, página inicial" />);
    const img = screen.getByRole("img", { name: "Rampa, página inicial" });
    expect(img).toHaveAttribute("viewBox", "0 0 64 72");
    expect(img).toHaveAttribute("width", "43");
  });

  it("as cores vêm de classes (tokens), não de valores no SVG", () => {
    const { container } = render(<Logo />);
    for (const el of container.querySelectorAll("path, rect")) expect(el).not.toHaveAttribute("fill");
  });
});
