import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AUDIT_ID, finding, wcagCatalog } from "../../test/fixtures";
import { axeViolations } from "../../test/render";
import { catalogFrom, type CriteriaCatalog } from "../criteria";
import { FindingGroup, groupFindings } from "./FindingGroup";

function renderGroups(items: Parameters<typeof groupFindings>[0], catalog?: CriteriaCatalog) {
  const router = createMemoryRouter([
    {
      path: "*",
      element: (
        <>
          {groupFindings(items).map((group) => (
            <FindingGroup key={group.key} auditId={AUDIT_ID} group={group} catalog={catalog} />
          ))}
        </>
      ),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("FindingGroup", () => {
  it("junta os elementos da mesma regra e severidade; revisão e severidade diferentes ficam em grupos próprios", () => {
    const groups = groupFindings([
      finding({ id: id(1) }),
      finding({ id: id(2), selector: "footer img" }),
      finding({ id: id(3), needs_review: true }),
      finding({ id: id(4), severity: "serious" }),
      finding({ id: id(5) }),
    ]);
    expect(groups.map((g) => g.findings.map((f) => f.id))).toEqual([[id(1), id(2), id(5)], [id(3)], [id(4)]]);
  });

  it("card com severidade (ícone e texto), título h3 em inglês marcado, regra, critério, origem e link por elemento", async () => {
    const { container } = renderGroups([finding({ id: id(1) }), finding({ id: id(2), selector: null })]);
    const card = screen.getByRole("article", { name: "Images must have alternative text" });
    expect(within(card).getByRole("heading", { level: 3 }).querySelector('[lang="en"]')).toHaveTextContent(
      "Images must have alternative text",
    );
    expect(card).toHaveTextContent("Crítico");
    expect(card).toHaveTextContent("image-alt");
    expect(card).toHaveTextContent("WCAG 1.1.1");
    expect(card).toHaveTextContent("Verificação automática (axe-core)");
    expect(within(card).getByRole("heading", { level: 4, name: "Elementos afetados (2)" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Ver o problema no elemento main > img" })).toHaveAttribute(
      "href",
      `/auditorias/${AUDIT_ID}/problemas/${id(1)}`,
    );
    expect(within(card).getByRole("link", { name: "Ver o problema no elemento Elemento sem seletor" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("CA1.3: com o catálogo, os critérios vêm com número e título; fora dele, só o número", async () => {
    const { container } = renderGroups(
      [finding({ id: id(1), wcag_criteria: ["4.1.2", "2.4.4", "4.1.1"] })],
      catalogFrom(wcagCatalog()),
    );
    const card = screen.getByRole("article");
    const criteria = within(card).getByText("Critérios", { selector: "dt" }).nextElementSibling;
    expect(criteria).toHaveTextContent("2.4.4 Finalidade do Link (Em Contexto); WCAG 4.1.1; 4.1.2 Nome, Função, Valor");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("achado do axe que pede revisão: 'O axe não conseguiu decidir'; da IA: selo da IA e confiança por elemento", () => {
    renderGroups([
      finding({ id: id(1), needs_review: true, rule_id: "color-contrast", help: null }),
      finding({ id: id(2), needs_review: true, source: "ai", rule_id: "rampa-alt-inadequate", confidence: 0.86 }),
    ]);
    const axe = screen.getByRole("article", { name: "Regra color-contrast" });
    expect(axe).toHaveTextContent("O axe não conseguiu decidir: confirme manualmente");
    const ai = screen.getAllByRole("article")[1]!;
    expect(ai).toHaveTextContent("Avaliado por IA, confirme manualmente");
    expect(ai).toHaveTextContent("Confiança alta (86%)");
  });
});
