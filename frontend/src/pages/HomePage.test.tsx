import { screen } from "@testing-library/react";
import { renderRoute } from "../../test/render";

describe("HomePage", () => {
  it("tem um único h1, igual ao título do documento", () => {
    renderRoute("/");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Seu site, para todo mundo");
    expect(document.title).toBe("Seu site, para todo mundo – Rampa");
  });

  it("avisa que a verificação automática não garante conformidade", () => {
    renderRoute("/");
    expect(screen.getByText(/não garante conformidade/)).toBeInTheDocument();
  });
});
