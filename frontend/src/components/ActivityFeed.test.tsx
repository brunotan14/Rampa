import { render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { ActivityFeed, FEED_MAX, type ActivityItem } from "./ActivityFeed";

const item = (n: number): ActivityItem => ({
  id: String(n),
  status: n % 2 ? "ok" : "falha",
  path: `/p${n}`,
  text: "analisada: 0 problemas",
  time: { label: "14:00:0" + (n % 10), iso: "2026-11-12T14:00:00.000Z" },
});

describe("ActivityFeed", () => {
  it("não é região viva e mostra no máximo os 6 últimos, em lista com título", async () => {
    const items = Array.from({ length: 9 }, (_, i) => item(i));
    const { container } = render(<ActivityFeed title="Atividade" items={items} empty="Esperando…" />);
    expect(screen.getByRole("region", { name: "Atividade" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(FEED_MAX);
    expect(container.querySelector("[aria-live], [role=log], [role=status], [role=alert]")).toBeNull();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("/p0 analisada: 0 problemas14:00:00");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("vazio diz o que vai aparecer", () => {
    render(<ActivityFeed title="Atividade" items={[]} empty="Esperando a primeira página…" />);
    expect(screen.getByText("Esperando a primeira página…")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
