import { act, render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { ScanProgress, type ScanProgressProps } from "./ScanProgress";

const base: ScanProgressProps = {
  url: "https://exemplo.com.br/",
  status: "running",
  found: 8,
  scanned: 0,
  failed: 0,
};

describe("ScanProgress", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-11-12T14:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("barra com valores e texto legível; contadores em lista de definição; nenhuma região viva própria", async () => {
    vi.useRealTimers();
    const { container } = render(<ScanProgress {...base} scanned={3} failed={1} />);
    const bar = screen.getByRole("progressbar", { name: "Analisando o site…" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuetext", "50%, 4 de 8 páginas verificadas");
    expect(screen.getByRole("heading", { level: 2, name: "Analisando o site…" })).toBeInTheDocument();
    expect(screen.getByText("Encontradas").closest("div")).toHaveTextContent("Encontradas8");
    expect(screen.getByText("Com falha").closest("div")).toHaveTextContent("Com falha1");
    // A região viva é da tela (LiveRegion), para não sumir quando este componente sai.
    expect(container.querySelectorAll("[aria-live], [role=status], [role=alert], [role=log]")).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("marca só os 25%, nunca cada página, e no máximo uma vez a cada 10 s", () => {
    const said: string[] = [];
    const onMilestone = (text: string) => said.push(text);
    const { rerender } = render(<ScanProgress {...base} onMilestone={onMilestone} />);

    // 8 páginas, uma por segundo: só o marco de 25% passa (os outros caem dentro dos 10 s).
    for (let scanned = 1; scanned <= 7; scanned++) {
      act(() => vi.advanceTimersByTime(1000));
      rerender(<ScanProgress {...base} scanned={scanned} onMilestone={onMilestone} />);
    }
    expect(said).toEqual(["25% concluído. 2 de 8 páginas verificadas."]);

    act(() => vi.advanceTimersByTime(10_000));
    rerender(<ScanProgress {...base} scanned={7} found={9} onMilestone={onMilestone} />);
    expect(said).toEqual(["25% concluído. 2 de 8 páginas verificadas.", "78% concluído. 7 de 9 páginas verificadas."]);
  });

  it("com páginas com falha, a frase usa os mesmos números do percentual", () => {
    const said: string[] = [];
    const { rerender } = render(<ScanProgress {...base} found={10} onMilestone={(text) => said.push(text)} />);
    rerender(<ScanProgress {...base} found={10} scanned={3} failed={2} onMilestone={(text) => said.push(text)} />);
    expect(said).toEqual(["50% concluído. 5 de 10 páginas verificadas, 2 com falha."]);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "50%, 5 de 10 páginas verificadas");
  });

  it("o marco em que a tela abriu não é anunciado, nem os 100%", () => {
    const onMilestone = vi.fn();
    const { rerender } = render(<ScanProgress {...base} scanned={4} onMilestone={onMilestone} />);
    act(() => vi.advanceTimersByTime(20_000));
    rerender(<ScanProgress {...base} scanned={8} onMilestone={onMilestone} />);
    expect(onMilestone).not.toHaveBeenCalled();
  });

  it("concluída: barra em 100% e título da conclusão", () => {
    render(<ScanProgress {...base} found={1} scanned={1} status="done" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("heading", { level: 2, name: "Varredura concluída" })).toBeInTheDocument();
  });

  it("falha: motivo na tela sem alerta próprio (quem fala é a região viva da tela)", async () => {
    vi.useRealTimers();
    const { container } = render(
      <ScanProgress
        {...base}
        status="failed"
        failed={1}
        found={1}
        errorMessage="A página demorou demais para carregar ou para ser analisada."
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/A página demorou demais/, { selector: "p" })).toHaveTextContent(/^Erro: A página/);
    expect(screen.getByRole("heading", { level: 2, name: "A varredura parou" })).toBeInTheDocument();
    expect(screen.queryByText(/Você pode sair desta página/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("total desconhecido: barra indeterminada, sem aria-valuenow", () => {
    render(<ScanProgress {...base} status="discovering" found={0} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-valuetext", "Procurando páginas, total ainda desconhecido");
  });
});
