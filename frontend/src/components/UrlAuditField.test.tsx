import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolations } from "../../test/render";
import { UrlAuditField } from "./UrlAuditField";

describe("UrlAuditField", () => {
  it("formulário com nome, rótulo visível, dica ligada e campo de URL sem validação nativa", async () => {
    const { container } = render(<UrlAuditField onSubmit={() => undefined} />);
    const form = screen.getByRole("form", { name: "Nova auditoria" });
    expect(form).toHaveAttribute("novalidate");
    const input = screen.getByRole("textbox", { name: "Endereço do site" });
    expect(input).toHaveAttribute("type", "url");
    expect(input).toHaveAttribute("autocomplete", "url");
    expect(input).toHaveAttribute("inputmode", "url");
    expect(input).toHaveAccessibleDescription(/Ex\.: exemplo\.com\.br/);
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("Enter no campo envia o endereço sem espaços nas pontas", async () => {
    const onSubmit = vi.fn();
    render(<UrlAuditField onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("textbox"), "  exemplo.com.br  {Enter}");
    expect(onSubmit).toHaveBeenCalledWith("exemplo.com.br");
  });

  it("vazio: mensagem em alerta, ligada ao campo, campo inválido e com foco; nada é enviado", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<UrlAuditField onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Auditar" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Erro: Cole o endereço do site que você quer auditar.");
    const input = screen.getByRole("textbox");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    // Erro primeiro, depois a dica (TextField: "aria-describedby aponta para erro e dica").
    expect(input).toHaveAccessibleDescription(/^Erro: Cole o endereço.*Ex\.: exemplo\.com\.br/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("erro da API de endereço: alerta, aria-invalid e foco no campo", () => {
    render(<UrlAuditField onSubmit={() => undefined} error={{ message: "Este endereço não pode ser auditado.", invalid: true }} errorKey={1} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Este endereço não pode ser auditado.");
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("erro que não é do endereço (rede, limite): ligado ao campo, mas sem aria-invalid", () => {
    render(<UrlAuditField onSubmit={() => undefined} error={{ message: "Não conseguimos falar com o Rampa.", invalid: false }} errorKey={1} />);
    const input = screen.getByRole("textbox");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription(/Não conseguimos falar com o Rampa/);
    expect(input).toHaveFocus();
  });

  it("o mesmo erro de novo remonta o alerta (é anunciado outra vez) e devolve o foco", () => {
    const error = { message: "Não encontramos este domínio.", invalid: true };
    const { rerender } = render(<UrlAuditField onSubmit={() => undefined} error={error} errorKey={1} />);
    const first = screen.getByRole("alert");
    screen.getByRole("button").focus();
    rerender(<UrlAuditField onSubmit={() => undefined} error={error} errorKey={2} />);
    expect(screen.getByRole("alert")).not.toBe(first);
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("carregando: botão diz Iniciando…, fica ocupado e não reenvia", async () => {
    const onSubmit = vi.fn();
    render(<UrlAuditField onSubmit={onSubmit} loading />);
    await userEvent.type(screen.getByRole("textbox"), "exemplo.com.br{Enter}");
    const button = screen.getByRole("button", { name: "Iniciando…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
