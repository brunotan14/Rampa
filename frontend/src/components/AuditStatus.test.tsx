import { render } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import type { AuditStatus as Status } from "../api/types";
import { AuditStatus } from "./AuditStatus";

const shape = (status: Status) => {
  const { container, unmount } = render(<AuditStatus status={status} />);
  const html = container.querySelector("svg")!.innerHTML;
  unmount();
  return html;
};

describe("AuditStatus", () => {
  it.each<[Status, string]>([
    ["queued", "Na fila"],
    ["running", "Em andamento"],
    ["completed", "Concluída"],
    ["failed", "Interrompida"],
    ["cancelled", "Cancelada"],
  ])("CA1.5: %s tem texto (%s) e ícone decorativo, não só cor", async (status, text) => {
    const { container } = render(<AuditStatus status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge).toHaveTextContent(text);
    expect(badge).toHaveClass("rp-pstatus", `rp-pstatus--${status}`);
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("CA1.5: concluída, interrompida, cancelada e em andamento têm formas de ícone diferentes", () => {
    const shapes = new Set((["running", "completed", "failed", "cancelled"] as const).map(shape));
    expect(shapes.size).toBe(4);
    expect(shape("queued")).toBe(shape("running"));
  });
});
