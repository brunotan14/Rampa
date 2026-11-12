import { errorMessage, plural, t } from ".";

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [String((value as (...a: number[]) => string)(2, 3, 1))];
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

describe("i18n", () => {
  it("nenhum texto afirma conformidade ou que um site é acessível", () => {
    const forbidden = /(está|estão|é|são) (conforme|acessíve(l|is))|site acessível|página acessível|100% acessível|certificad/i;
    const offenders = allStrings(t).filter((s) => forbidden.test(s));
    expect(offenders).toEqual([]);
  });

  it("sem ponto de exclamação nem 'Ops'", () => {
    expect(allStrings(t).filter((s) => /!|\bops\b/i.test(s))).toEqual([]);
  });

  it("tem mensagem para os códigos da API e cai na genérica para código desconhecido", () => {
    expect(errorMessage("audit_not_found")).toBe("Auditoria não encontrada. Confira o endereço do relatório.");
    expect(errorMessage("network_error")).toMatch(/conexão/);
    expect(errorMessage("codigo_novo")).toBe(t.errors.internal_error);
    expect(errorMessage("toString")).toBe(t.errors.internal_error);
  });

  it("plural com números no formato brasileiro", () => {
    expect(plural(1, "página", "páginas")).toBe("1 página");
    expect(plural(0, "página", "páginas")).toBe("0 páginas");
    expect(plural(2048, "página", "páginas")).toBe("2.048 páginas");
  });

  it("anuncia a conclusão no formato do RF-RA004", () => {
    expect(t.channel.completed(12, 4, 0)).toBe("Auditoria concluída: 12 problemas em 4 páginas.");
    expect(t.channel.completed(1, 1, 0)).toBe("Auditoria concluída: 1 problema em 1 página.");
    expect(t.channel.completed(3, 4, 1)).toBe("Auditoria concluída: 3 problemas em 4 páginas. 1 página com falha.");
  });
});
