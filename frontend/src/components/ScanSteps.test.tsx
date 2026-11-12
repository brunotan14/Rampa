import { render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { ScanSteps } from "./ScanSteps";

const steps = ["Na fila", "Varredura automática", "Relatório"];

describe("ScanSteps", () => {
  it("lista ordenada com nome; a etapa atual tem aria-current e todas dizem o estado em texto", async () => {
    const { container } = render(<ScanSteps label="Etapas da auditoria" steps={steps} current={1} />);
    const list = screen.getByRole("list", { name: "Etapas da auditoria" });
    expect(list.tagName).toBe("OL");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Na fila, concluída",
      "2Varredura automática, em andamento",
      "3Relatório, pendente",
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("todas concluídas e etapa interrompida", () => {
    const { rerender } = render(<ScanSteps label="Etapas" steps={steps} current={3} />);
    expect(screen.getAllByText(/concluída/)).toHaveLength(3);
    rerender(<ScanSteps label="Etapas" steps={steps} current={1} stopped />);
    expect(screen.getByText(/interrompida/)).toBeInTheDocument();
    expect(document.querySelector("[aria-current]")).toBeNull();
  });
});
