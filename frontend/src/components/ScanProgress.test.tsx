import { act, render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { ScanProgress, type ScanProgressProps } from "./ScanProgress";

const base: ScanProgressProps = {
  url: "https://exemplo.com.br/",
  status: "running",
  found: 8,
  scanned: 0,
  failed: 0,
  announcement: null,
};

function live() {
  return screen.getByRole("status");
}

describe("ScanProgress", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-11-12T14:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("barra com valores e texto legível; contadores em lista de definição; uma única região viva", async () => {
    vi.useRealTimers();
    const { container } = render(<ScanProgress {...base} scanned={3} failed={1} />);
    const bar = screen.getByRole("progressbar", { name: "Analisando o site…" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuetext", "50%, 4 de 8 páginas verificadas");
    expect(screen.getByRole("heading", { level: 2, name: "Analisando o site…" })).toBeInTheDocument();
    expect(screen.getByText("Encontradas").closest("div")).toHaveTextContent("Encontradas8");
    expect(screen.getByText("Com falha").closest("div")).toHaveTextContent("Com falha1");
    expect(container.querySelectorAll("[aria-live], [role=status], [role=alert], [role=log]")).toHaveLength(1);
    expect(live()).toHaveAttribute("aria-live", "polite");
    expect(live()).toBeEmptyDOMElement();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("anuncia só nos marcos de 25%, nunca a cada página, e no máximo uma vez a cada 10 s", () => {
    const { rerender } = render(<ScanProgress {...base} />);
    const said: string[] = [];
    const record = () => {
      const text = live().textContent ?? "";
      if (text !== "" && said.at(-1) !== text) said.push(text);
    };

    // 8 páginas, uma por segundo: só o marco de 25% passa (os outros caem dentro dos 10 s).
    for (let scanned = 1; scanned <= 7; scanned++) {
      act(() => vi.advanceTimersByTime(1000));
      rerender(<ScanProgress {...base} scanned={scanned} />);
      record();
    }
    expect(said).toEqual(["25% concluído. 2 de 8 páginas analisadas."]);

    // Passados 10 s, o próximo marco é anunciado.
    act(() => vi.advanceTimersByTime(10_000));
    rerender(<ScanProgress {...base} scanned={7} failed={0} found={9} />);
    record();
    expect(said).toEqual(["25% concluído. 2 de 8 páginas analisadas.", "78% concluído. 7 de 9 páginas analisadas."]);
  });

  it("o marco em que a tela abriu não é anunciado", () => {
    render(<ScanProgress {...base} scanned={4} />);
    expect(live()).toBeEmptyDOMElement();
  });

  it("a conclusão vence o marco e é anunciada uma vez; a barra chega a 100%", () => {
    const { rerender } = render(<ScanProgress {...base} found={1} />);
    rerender(
      <ScanProgress
        {...base}
        found={1}
        scanned={1}
        status="done"
        announcement="Auditoria concluída: 3 problemas em 1 página."
      />,
    );
    expect(live()).toHaveTextContent("Auditoria concluída: 3 problemas em 1 página.");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("heading", { level: 2, name: "Varredura concluída" })).toBeInTheDocument();
  });

  it("falha: motivo na tela sem alerta próprio (quem fala é a região viva)", async () => {
    vi.useRealTimers();
    const { container } = render(
      <ScanProgress
        {...base}
        status="failed"
        failed={1}
        found={1}
        errorMessage="A página demorou demais para carregar ou para ser analisada."
        announcement="A auditoria parou. A página demorou demais para carregar ou para ser analisada."
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/A página demorou demais/, { selector: "p" })).toHaveTextContent(/^Erro: A página/);
    expect(live()).toHaveTextContent("A auditoria parou.");
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
