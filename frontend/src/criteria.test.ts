import { wcagCatalog } from "../test/fixtures";
import {
  catalogFrom,
  compareNumbering,
  criteriaFor,
  criteriaText,
  criterionShortLabel,
  isHttpsUrl,
  whoIsAffected,
} from "./criteria";

const catalog = catalogFrom(wcagCatalog());
const ids = (refs: { id: string }[]) => refs.map((ref) => ref.id);

describe("criteriaFor e criterionShortLabel (RF-RA007)", () => {
  it("rótulo curto com número e título; sem conteúdo, 'WCAG' e o número como no M2", () => {
    const [known] = criteriaFor(["1.1.1"], catalog);
    expect(criterionShortLabel(known!)).toBe("1.1.1 Conteúdo Não Textual");
    expect(criterionShortLabel({ id: "1.1.1", criterion: null })).toBe("WCAG 1.1.1");
  });

  it("sem repetição e em ordem numérica por componente (1.4.5 antes de 1.4.10)", () => {
    expect(ids(criteriaFor(["1.4.10", "1.4.5", "1.1.1", "1.4.5"], catalog))).toEqual(["1.1.1", "1.4.5", "1.4.10"]);
    expect(compareNumbering("3.9", "3.10")).toBeLessThan(0);
    expect(compareNumbering("1.4.10", "1.4.5")).toBeGreaterThan(0);
  });

  it("CA1.4: achado sem critério fica com 'Sem critério WCAG associado'", () => {
    expect(criteriaFor([], catalog)).toEqual([]);
    expect(criteriaText([], catalog)).toBe("Sem critério WCAG associado");
  });

  it("CA1.5: critério fora do catálogo (4.1.1) fica só com o número, sem título, nível nem link", () => {
    const refs = criteriaFor(["4.1.1", "1.1.1"], catalog);
    expect(refs[0]).toMatchObject({ id: "1.1.1", criterion: { title: "Conteúdo Não Textual" } });
    expect(refs[1]).toEqual({ id: "4.1.1", criterion: null });
    expect(criteriaText(["4.1.1", "1.1.1"], catalog)).toBe("1.1.1 Conteúdo Não Textual; WCAG 4.1.1");
  });

  it("catálogo ausente (não chegou ou falhou): só os números", () => {
    expect(criteriaFor(["2.4.4", "1.1.1"], undefined)).toEqual([
      { id: "1.1.1", criterion: null },
      { id: "2.4.4", criterion: null },
    ]);
    expect(criteriaText(["2.4.4", "1.1.1"], null)).toBe("WCAG 1.1.1; WCAG 2.4.4");
  });

  it("CA1.6: 2.1.3 (nível AAA) junto do 2.1.1, os dois com título", () => {
    const refs = criteriaFor(["2.1.3", "2.1.1"], catalog);
    expect(refs.map(criterionShortLabel)).toEqual(["2.1.1 Teclado", "2.1.3 Teclado (Sem Exceção)"]);
    expect(refs[1]!.criterion?.level).toBe("AAA");
  });

  it("os rótulos numa linha se separam por ponto e vírgula: os títulos têm vírgula", () => {
    expect(criteriaText(["4.1.2", "2.4.4"], catalog)).toBe("2.4.4 Finalidade do Link (Em Contexto); 4.1.2 Nome, Função, Valor");
  });

  it("só https vira link", () => {
    expect(isHttpsUrl("https://www.w3.org/x")).toBe(true);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
  });
});

describe("whoIsAffected (FR-008)", () => {
  it("CA2.1/CA2.2: sem texto do achado, o de cada critério conhecido, identificado por número e título", () => {
    const who = whoIsAffected({ who_is_affected: null }, criteriaFor(["1.4.3", "1.1.1", "4.1.1"], catalog));
    expect(who).toEqual({
      kind: "criteria",
      items: [
        {
          id: "1.1.1",
          label: "1.1.1 Conteúdo Não Textual",
          text: "Pessoas cegas que usam leitor de tela ouvem o texto alternativo no lugar da imagem.",
        },
        {
          id: "1.4.3",
          label: "1.4.3 Contraste (Mínimo)",
          text: "Pessoas com baixa visão têm dificuldade para ler texto claro sobre fundo claro.",
        },
      ],
    });
  });

  it("CA2.5: o texto do próprio achado vence os dos critérios", () => {
    expect(whoIsAffected({ who_is_affected: "Pessoas que usam leitor de tela." }, criteriaFor(["1.1.1"], catalog))).toEqual({
      kind: "finding",
      text: "Pessoas que usam leitor de tela.",
    });
  });

  it("CA2.3: sem texto do achado e sem critério conhecido, nada (a seção não aparece)", () => {
    expect(whoIsAffected({ who_is_affected: null }, criteriaFor(["4.1.1"], catalog))).toBeNull();
    expect(whoIsAffected({ who_is_affected: "  " }, [])).toBeNull();
    expect(whoIsAffected({}, criteriaFor(["1.1.1"], null))).toBeNull();
  });
});
