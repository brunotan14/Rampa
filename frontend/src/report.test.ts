import { pageSummary } from "../test/fixtures";
import {
  confidenceBand,
  filterAndSortPages,
  hostOf,
  isAuditId,
  pageLinkSearch,
  pageName,
  readFindingFilters,
  readPageListState,
  toApiFilters,
  writeFindingFilters,
  writePageListState,
} from "./report";

const PAGE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const zero = { critical: 0, serious: 0, moderate: 0, minor: 0 };

describe("report: ids e endereços", () => {
  it("só aceita o UUID canônico", () => {
    expect(isAuditId(PAGE)).toBe(true);
    expect(isAuditId(PAGE.toUpperCase())).toBe(false);
    expect(isAuditId("123")).toBe(false);
    expect(isAuditId(undefined)).toBe(false);
  });

  it("host, e nome da página pelo título ou pelo caminho", () => {
    expect(hostOf("https://exemplo.com.br:8443/x")).toBe("exemplo.com.br:8443");
    expect(hostOf("não é url")).toBeNull();
    expect(pageName({ title: "  Contato ", url: "https://e.com/c" })).toBe("Contato");
    expect(pageName({ title: null, url: "https://e.com/a", final_url: "https://e.com/b?x=1" })).toBe("/b?x=1");
  });
});

describe("report: filtros dos problemas na URL (RF-RA006)", () => {
  it("lê os nomes em português e converte para a API, na ordem por severidade", () => {
    const filters = readFindingFilters(new URLSearchParams("severidade=critico&origem=ia&wcag=1.4.3&revisao=sim"));
    expect(filters).toEqual({ severidade: "critico", origem: "ai", wcag: "1.4.3", revisao: "sim" });
    expect(toApiFilters(PAGE, filters)).toEqual({
      page_id: PAGE,
      sort: "severity",
      severity: "critical",
      source: "ai",
      wcag: "1.4.3",
      needs_review: "true",
    });
    expect(toApiFilters(PAGE, { revisao: "nao", origem: "heuristic" })).toMatchObject({ needs_review: "false", source: "heuristic" });
  });

  it("ignora valores desconhecidos em vez de mandar um filtro que a API recusaria", () => {
    expect(readFindingFilters(new URLSearchParams("severidade=critical&origem=ai&wcag=1.4&revisao=talvez"))).toEqual({
      severidade: undefined,
      origem: undefined,
      wcag: undefined,
      revisao: undefined,
    });
  });

  it("escreve os filtros sem perder os outros parâmetros", () => {
    const next = writeFindingFilters(new URLSearchParams("aba=aprovados&severidade=menor"), { origem: "heuristic", wcag: "2.4.4" });
    expect(next.toString()).toBe("aba=aprovados&origem=heuristica&wcag=2.4.4");
  });
});

describe("report: lista de páginas", () => {
  const a = pageSummary({ id: "a", url: "https://e.com/0", counts_by_severity: { ...zero, serious: 3 } });
  const b = pageSummary({ id: "b", url: "https://e.com/a", counts_by_severity: { ...zero, critical: 1 }, needs_review_count: 2 });
  const c = pageSummary({ id: "c", url: "https://e.com/c", status: "failed" });

  it("ordena pela gravidade (críticos primeiro), pelo endereço ou com as falhas primeiro", () => {
    expect(filterAndSortPages([a, b, c], readPageListState(new URLSearchParams())).map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(filterAndSortPages([c, b, a], readPageListState(new URLSearchParams("ordem=endereco"))).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(filterAndSortPages([a, b, c], readPageListState(new URLSearchParams("ordem=status"))).map((p) => p.id)[0]).toBe("c");
  });

  it("filtra pela severidade e pela revisão, a partir dos totais", () => {
    expect(filterAndSortPages([a, b, c], readPageListState(new URLSearchParams("severidade=serio"))).map((p) => p.id)).toEqual(["a"]);
    expect(filterAndSortPages([a, b, c], readPageListState(new URLSearchParams("revisao=sim"))).map((p) => p.id)).toEqual(["b"]);
  });

  it("guarda o estado na URL e leva para a página só os filtros que valem para os problemas", () => {
    const state = readPageListState(new URLSearchParams("severidade=critico&revisao=sim&ordem=status&x=1"));
    expect(writePageListState(new URLSearchParams("x=1"), state).toString()).toBe("x=1&severidade=critico&revisao=sim&ordem=status");
    expect(writePageListState(new URLSearchParams(), { ordem: "gravidade" }).toString()).toBe("");
    expect(pageLinkSearch(state)).toBe("?severidade=critico&revisao=sim");
    expect(pageLinkSearch({ ordem: "endereco" })).toBe("");
  });
});

describe("report: confiança da IA", () => {
  it("alta a partir de 80%, média de 50% a 79%, baixa abaixo", () => {
    expect(confidenceBand(0.8)).toBe("alta");
    expect(confidenceBand(0.79)).toBe("media");
    expect(confidenceBand(0.5)).toBe("media");
    expect(confidenceBand(0.49)).toBe("baixa");
  });
});
