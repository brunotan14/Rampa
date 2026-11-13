import { act, render, screen } from "@testing-library/react";
import { Reveal } from "./Reveal";

function stubMotion(allowed: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: allowed && query.includes("no-preference"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("Reveal", () => {
  it("com movimento reduzido, o conteúdo já está visível, sem classe de animação", () => {
    stubMotion(false);
    render(<Reveal as="section" aria-labelledby="t"><h2 id="t">Título</h2></Reveal>);
    expect(screen.getByRole("region", { name: "Título" })).not.toHaveClass("rp-reveal");
  });

  it("sem IntersectionObserver, também visível", () => {
    stubMotion(true);
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Reveal>conteúdo</Reveal>);
    expect(screen.getByText("conteúdo")).not.toHaveClass("rp-reveal");
  });

  it("com movimento, aparece ao entrar na tela, uma vez", () => {
    stubMotion(true);
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    render(<Reveal step={2}>conteúdo</Reveal>);
    const el = screen.getByText("conteúdo");
    expect(el).toHaveClass("rp-reveal");
    expect(el).not.toHaveClass("is-in");
    expect(el.style.getPropertyValue("--rp-step")).toBe("2");
    act(() => notify([{ isIntersecting: true }]));
    expect(el).toHaveClass("is-in");
    expect(disconnect).toHaveBeenCalled();
  });
});
