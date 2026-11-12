import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { axeViolations } from "../../test/render";
import { Link } from "./Link";

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("Link", () => {
  it("interno navega pelo roteador, sem abrir nova aba", () => {
    inRouter(<Link href="/auditorias">Ver auditorias</Link>);
    const link = screen.getByRole("link", { name: "Ver auditorias" });
    expect(link).toHaveAttribute("href", "/auditorias");
    expect(link).not.toHaveAttribute("target");
    expect(link).toHaveClass("rp-link");
  });

  it("externo abre em nova aba, sem referrer, e diz isso no nome", () => {
    inRouter(
      <Link href="https://www.w3.org/TR/WCAG22/" external>
        Entendendo a WCAG 2.2
      </Link>,
    );
    const link = screen.getByRole("link", { name: "Entendendo a WCAG 2.2 (abre em nova aba)" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("isolado ganha a classe de alvo mínimo", () => {
    inRouter(
      <Link href="/" standalone>
        Voltar
      </Link>,
    );
    expect(screen.getByRole("link", { name: "Voltar" })).toHaveClass("rp-link--standalone");
  });

  it("não tem violações do axe", async () => {
    const { container } = inRouter(
      <p>
        <Link href="/">Início</Link> e{" "}
        <Link href="https://example.org/" external>
          referência
        </Link>
      </p>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
