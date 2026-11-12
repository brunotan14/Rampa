import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolations } from "../../test/render";
import { Button } from "./Button";

describe("Button", () => {
  it("é um botão nativo do tipo button, ativado por Enter e Espaço", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Auditar</Button>);
    const button = screen.getByRole("button", { name: "Auditar" });
    expect(button).toHaveAttribute("type", "button");
    button.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("indisponível continua focável, é anunciado e não dispara a ação", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Reauditar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Reauditar" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("carregando troca o rótulo, marca ocupado e ignora cliques", async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Auditando…" onClick={onClick}>
        Auditar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Auditando…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("não envia o formulário quando indisponível", async () => {
    const onSubmit = vi.fn((e: SubmitEvent) => e.preventDefault());
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent as SubmitEvent)}>
        <Button type="submit" disabled>
          Auditar
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Auditar" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("o ícone é decorativo", () => {
    const { container } = render(<Button iconStart="busca">Buscar</Button>);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("não tem violações do axe em nenhuma variante", async () => {
    const { container } = render(
      <>
        <Button>Primário</Button>
        <Button variant="secondary">Secundário</Button>
        <Button variant="ghost" size="sm">
          Copiar seletor
        </Button>
        <Button variant="danger" size="lg">
          Excluir
        </Button>
        <Button disabled>Indisponível</Button>
        <Button loading loadingLabel="Auditando…">
          Auditar
        </Button>
      </>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
