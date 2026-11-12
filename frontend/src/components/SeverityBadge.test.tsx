import { render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { SeverityBadge } from "./SeverityBadge";

describe("SeverityBadge", () => {
  it.each([
    ["critico", "Crítico"],
    ["serio", "Sério"],
    ["moderado", "Moderado"],
    ["menor", "Menor"],
    ["sucesso", "Aprovado"],
    ["revisao", "Confirme manualmente"],
  ] as const)("%s mostra a palavra %s, com ícone decorativo", (level, text) => {
    const { container } = render(<SeverityBadge level={level} />);
    const badge = container.querySelector(".rp-badge")!;
    expect(badge).toHaveTextContent(text);
    expect(badge).toHaveClass(`rp-badge--${level}`);
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["critico", 3, "3 críticos"],
    ["serio", 1, "1 sério"],
    ["menor", 12, "12 menores"],
    ["moderado", 0, "0 moderados"],
    ["critico", 1234, "1.234 críticos"],
  ] as const)("%s com contagem %d diz %s", (level, count, text) => {
    const { container } = render(<SeverityBadge level={level} count={count} />);
    expect(container.querySelector(".rp-badge")).toHaveTextContent(text);
  });

  it("o rótulo próprio substitui o padrão", () => {
    render(<SeverityBadge level="sucesso" label="Aprovado nesta página" />);
    expect(screen.getByText("Aprovado nesta página")).toBeInTheDocument();
  });

  it("não é interativo nem tem papel", () => {
    const { container } = render(<SeverityBadge level="serio" count={2} />);
    const badge = container.querySelector(".rp-badge")!;
    expect(badge.tagName).toBe("SPAN");
    expect(badge).not.toHaveAttribute("role");
    expect(badge).not.toHaveAttribute("tabindex");
  });

  it("não tem violações do axe", async () => {
    const { container } = render(
      <p>
        <SeverityBadge level="critico" count={3} /> <SeverityBadge level="revisao" />
      </p>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
