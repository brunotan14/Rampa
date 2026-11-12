import { act, render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { StatCard, StatGrid } from "./StatCard";

function mockMotion(allowed: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: allowed, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

/** `matchMedia` com a preferência trocável no meio do teste (evento `change`). */
function switchableMotion(initial: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => list));
  return (allowed: boolean) => {
    list.matches = allowed;
    for (const fn of listeners) fn();
  };
}

describe("StatCard e CountUp", () => {
  it("valor mudado com movimento reduzido e depois a preferência trocada: mostra o valor certo", async () => {
    const setMotion = switchableMotion(false);
    vi.useFakeTimers();
    const { rerender } = render(<StatCard label="Analisadas" value={1} />);
    rerender(<StatCard label="Analisadas" value={7} />);
    act(() => setMotion(true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const value = screen.getByRole("definition");
    expect(value).toHaveTextContent(/^7$/);
    expect(value.querySelector("[aria-hidden=true]")).toBeNull();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("par termo/valor dentro de um <dl>; com movimento reduzido, o valor final direto", async () => {
    mockMotion(false);
    const { container, rerender } = render(
      <StatGrid>
        <StatCard label="Críticos" value={3} icon="critico" tone="critico" />
      </StatGrid>,
    );
    expect(screen.getByRole("term")).toHaveTextContent("Críticos");
    expect(screen.getByRole("definition")).toHaveTextContent(/^3$/);
    rerender(
      <StatGrid>
        <StatCard label="Críticos" value={1200} icon="critico" tone="critico" />
      </StatGrid>,
    );
    expect(screen.getByRole("definition")).toHaveTextContent(/^1\.200$/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("com movimento, o número que conta fica escondido e o valor final fica em texto oculto", async () => {
    mockMotion(true);
    vi.useFakeTimers();
    const { rerender } = render(<StatCard label="Analisadas" value={0} />);
    rerender(<StatCard label="Analisadas" value={10} />);
    const value = screen.getByRole("definition");
    expect(value.querySelector("[aria-hidden=true]")).toHaveTextContent("0");
    expect(value.querySelector(".rp-sr")).toHaveTextContent("10");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(value).toHaveTextContent(/^10$/);
    expect(value.querySelector("[aria-hidden=true]")).toBeNull();
  });
});
