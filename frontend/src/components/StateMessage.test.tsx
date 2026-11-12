import { act, render, screen } from "@testing-library/react";
import { axeViolations } from "../../test/render";
import { Button } from "./Button";
import { StateMessage } from "./StateMessage";

describe("StateMessage", () => {
  afterEach(() => vi.useRealTimers());

  it("vazio é uma seção com título h2, texto e ação, sem alerta", () => {
    render(
      <StateMessage
        kind="vazio"
        title="Nenhuma auditoria ainda"
        text="Cole o endereço de um site para começar."
        actions={<Button>Auditar</Button>}
      />,
    );
    const region = screen.getByRole("region", { name: "Nenhuma auditoria ainda" });
    expect(screen.getByRole("heading", { level: 2, name: "Nenhuma auditoria ainda" })).toBeInTheDocument();
    expect(region).toHaveTextContent("Cole o endereço de um site para começar.");
    expect(screen.getByRole("button", { name: "Auditar" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("erro é um alerta, com o prefixo oculto Erro:", () => {
    render(
      <StateMessage
        kind="erro"
        title="O site bloqueou a nossa visita"
        text="Isso costuma ser um firewall que barra robôs."
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Erro: O site bloqueou a nossa visita");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Erro: O site bloqueou a nossa visita");
  });

  it("erro que já estava na tela pode ficar sem alerta", () => {
    render(<StateMessage kind="erro" title="Auditoria não encontrada" alert={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("region", { name: "Erro: Auditoria não encontrada" })).toBeInTheDocument();
  });

  it("leva o foco ao título quando pedido", () => {
    render(<StateMessage kind="erro" title="A varredura parou" focusTitle headingLevel={3} />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveFocus();
  });

  it("carregando é um status com texto para o leitor de tela e skeleton escondido", () => {
    const { container } = render(<StateMessage kind="carregando" title="Carregando o relatório…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando o relatório…");
    expect(container.querySelector(".rp-skeleton")).toHaveAttribute("aria-hidden", "true");
  });

  it("carregando há mais de 10 s mostra o que está demorando", () => {
    vi.useFakeTimers();
    render(<StateMessage kind="carregando" />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
    expect(screen.queryByText(/demorando mais do que o normal/)).toBeNull();
    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.queryByText(/demorando mais do que o normal/)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent(/demorando mais do que o normal/);
  });

  it("não tem violações do axe nos três estados", async () => {
    const { container } = render(
      <>
        <StateMessage kind="vazio" title="Nada aqui" text="Ainda." />
        <StateMessage kind="erro" title="Deu errado" text="Tente de novo." />
        <StateMessage kind="carregando" />
      </>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
