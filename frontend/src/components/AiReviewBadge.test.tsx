import { render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { AiReviewBadge } from "./AiReviewBadge";

describe("AiReviewBadge", () => {
  it("diz que é da IA e a confiança em palavra e número; as barras são decorativas", async () => {
    const { container } = render(<AiReviewBadge confidence={0.86} />);
    expect(container).toHaveTextContent("Avaliado por IA, confirme manualmente");
    expect(container).toHaveTextContent("Confiança alta (86%)");
    expect(container.querySelector(".rp-ai__bars")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".rp-ai__bars i.on")).toHaveLength(3);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("média e baixa, e sem confiança só o selo", () => {
    const { container, rerender } = render(<AiReviewBadge confidence={0.64} />);
    expect(container).toHaveTextContent("Confiança média (64%)");
    rerender(<AiReviewBadge confidence={0.3} />);
    expect(container).toHaveTextContent("Confiança baixa (30%)");
    rerender(<AiReviewBadge confidence={null} />);
    expect(container).toHaveTextContent("Avaliado por IA, confirme manualmente");
    expect(screen.queryByText(/Confiança/)).not.toBeInTheDocument();
  });
});
