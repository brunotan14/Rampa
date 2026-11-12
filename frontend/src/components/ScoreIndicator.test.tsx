import { render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { ScoreIndicator, scoreBand } from "./ScoreIndicator";
import { SeverityBar } from "./SeverityBar";

describe("ScoreIndicator", () => {
  it("figura com o rótulo do PRD, número, faixa em palavras e frase; o anel é decorativo", async () => {
    const { container } = render(<ScoreIndicator value={72} description="Corrija os críticos primeiro." />);
    const figure = screen.getByRole("figure");
    expect(figure).toHaveTextContent(
      "Indicador de problemas encontrados automaticamente72 de 100Precisa de atençãoCorrija os críticos primeiro.",
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(figure).not.toHaveTextContent(/acessível|conforme/i);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("faixas do design system", () => {
    expect([100, 90, 89, 75, 74, 50, 49, 0].map(scoreBand)).toEqual([
      "excelente", "excelente", "bom", "bom", "atencao", "atencao", "graves", "graves",
    ]);
  });
});

describe("SeverityBar", () => {
  it("barra escondida; legenda em lista com selo, contagem e porcentagem", async () => {
    const { container } = render(
      <SeverityBar label="Problemas por severidade" items={[{ level: "critico", count: 1 }, { level: "menor", count: 3 }, { level: "revisao", count: 0 }]} />,
    );
    expect(container.querySelector(".rp-sevbar__track")).toHaveAttribute("aria-hidden", "true");
    const items = screen.getAllByRole("listitem", { name: undefined });
    expect(screen.getByRole("list", { name: "Problemas por severidade" })).toBeInTheDocument();
    expect(items.map((li) => li.textContent)).toEqual(["1 crítico25%", "3 menores75%", "0 a confirmar0%"]);
    expect(container.querySelectorAll(".rp-sevbar__seg")).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });
});
