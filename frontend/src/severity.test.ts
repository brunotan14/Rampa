import {
  API_SEVERITIES,
  FINDING_SEVERITIES,
  fromApiSeverity,
  severityCountLabel,
  severityIcon,
  severityLabel,
  severityTotals,
  toApiSeverity,
  totalProblems,
} from "./severity";

describe("severidade", () => {
  it("converte os nomes do axe para os do design system", () => {
    expect(fromApiSeverity("critical")).toBe("critico");
    expect(fromApiSeverity("serious")).toBe("serio");
    expect(fromApiSeverity("moderate")).toBe("moderado");
    expect(fromApiSeverity("minor")).toBe("menor");
  });

  it("a conversão é de ida e volta para todo nível da API", () => {
    for (const s of API_SEVERITIES) expect(toApiSeverity(fromApiSeverity(s))).toBe(s);
  });

  it("ordena do mais grave para o menos grave", () => {
    expect(FINDING_SEVERITIES).toEqual(["critico", "serio", "moderado", "menor"]);
  });

  it("dá rótulo e ícone de forma própria a cada nível", () => {
    expect(severityLabel("critico")).toBe("Crítico");
    expect(severityLabel("sucesso")).toBe("Aprovado");
    expect(severityLabel("revisao")).toBe("Confirme manualmente");
    const icons = (["critico", "serio", "moderado", "menor", "sucesso", "revisao"] as const).map(severityIcon);
    expect(new Set(icons).size).toBe(6);
  });

  it("conta no singular e no plural", () => {
    expect(severityCountLabel("critico", 1)).toBe("1 crítico");
    expect(severityCountLabel("critico", 3)).toBe("3 críticos");
    expect(severityCountLabel("serio", 0)).toBe("0 sérios");
    expect(severityCountLabel("menor", 12)).toBe("12 menores");
  });

  it("lê os totais da API na ordem do design system e soma os problemas", () => {
    const totals = { critical: 1, serious: 2, moderate: 3, minor: 4 };
    expect(severityTotals(totals)).toEqual([
      { severity: "critico", count: 1 },
      { severity: "serio", count: 2 },
      { severity: "moderado", count: 3 },
      { severity: "menor", count: 4 },
    ]);
    expect(totalProblems(totals)).toBe(10);
  });
});
