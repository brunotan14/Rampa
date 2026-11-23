import {
  MAX_RECENT,
  RECENT_KEY,
  clearRecent,
  readRecent,
  recentLabel,
  recordRecent,
  removeRecent,
  safeText,
  updateRecentStatus,
  type RecentAudit,
} from "./recentAudits";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function base(n: number): Omit<RecentAudit, "lastOpenedAt"> {
  return { id: id(n), startUrl: `https://site${n}.exemplo.com.br/`, createdAt: "2026-11-12T10:00:00Z", status: "completed" };
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 12, minute));

function store(value: unknown) {
  localStorage.setItem(RECENT_KEY, typeof value === "string" ? value : JSON.stringify(value));
}

function item(n: number, overrides: Partial<RecentAudit> = {}): RecentAudit {
  return { ...base(n), lastOpenedAt: at(n).toISOString(), ...overrides };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("recentAudits", () => {
  it("CA1.1: lista vazia sem nada guardado; grava e lê da mais recente para a mais antiga", () => {
    expect(readRecent()).toEqual([]);
    recordRecent(base(1), at(1));
    recordRecent(base(2), at(2));
    expect(readRecent().map((r) => r.id)).toEqual([id(2), id(1)]);
    expect(readRecent()[0]).toEqual({ ...base(2), lastOpenedAt: at(2).toISOString() });
  });

  it("CA1.6: a leitura ordena por lastOpenedAt, mesmo com o array guardado fora de ordem", () => {
    store({ version: 1, items: [item(1), item(3), item(2)] });
    expect(readRecent().map((r) => r.id)).toEqual([id(3), id(2), id(1)]);
  });

  it("CA1.6: reabrir uma auditoria antiga a leva ao topo, com a mesma data de criação, sem duplicar", () => {
    recordRecent({ ...base(1), createdAt: "2026-11-01T08:00:00Z" }, at(1));
    recordRecent(base(2), at(2));
    recordRecent(base(3), at(3));
    recordRecent({ ...base(1), createdAt: "2026-11-01T08:00:00Z", status: "running" }, at(4));
    const list = readRecent();
    expect(list.map((r) => r.id)).toEqual([id(1), id(3), id(2)]);
    expect(list[0]).toMatchObject({ createdAt: "2026-11-01T08:00:00Z", status: "running", lastOpenedAt: at(4).toISOString() });
  });

  it("CA1.4: com 10 na lista, a 11ª entra e a mais antiga sai", () => {
    for (let n = 1; n <= MAX_RECENT; n++) recordRecent(base(n), at(n));
    expect(readRecent()).toHaveLength(MAX_RECENT);
    recordRecent(base(11), at(11));
    const list = readRecent();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]!.id).toBe(id(11));
    expect(list.map((r) => r.id)).not.toContain(id(1));
    // Guardado também com 10, não só lido.
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!).items).toHaveLength(MAX_RECENT);
  });

  it("CA1.4: dados com mais de 10 itens são lidos só com os 10 mais recentes", () => {
    store({ version: 1, items: Array.from({ length: 12 }, (_, i) => item(i + 1)) });
    const list = readRecent();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list.at(-1)!.id).toBe(id(3));
  });

  it("CA1.3: updateRecentStatus troca só o status, sem mudar a posição nem lastOpenedAt", () => {
    recordRecent({ ...base(1), status: "running" }, at(1));
    recordRecent(base(2), at(2));
    updateRecentStatus(id(1), "completed");
    const list = readRecent();
    expect(list.map((r) => r.id)).toEqual([id(2), id(1)]);
    expect(list[1]).toEqual({ ...base(1), status: "completed", lastOpenedAt: at(1).toISOString() });
  });

  it("CA1.3: updateRecentStatus de um id fora da lista não cria item", () => {
    updateRecentStatus(id(9), "completed");
    expect(readRecent()).toEqual([]);
  });

  it("CA2.4: removeRecent tira só o item pedido; clearRecent apaga tudo", () => {
    recordRecent(base(1), at(1));
    recordRecent(base(2), at(2));
    removeRecent(id(1));
    expect(readRecent().map((r) => r.id)).toEqual([id(2)]);
    clearRecent();
    expect(readRecent()).toEqual([]);
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });

  it("CA4.1: com o acesso ao localStorage lançando, lê vazio e nenhuma função lança", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    expect(readRecent()).toEqual([]);
    expect(() => recordRecent(base(1), at(1))).not.toThrow();
    expect(() => updateRecentStatus(id(1), "failed")).not.toThrow();
    expect(() => removeRecent(id(1))).not.toThrow();
    expect(() => clearRecent()).not.toThrow();
  });

  it("CA4.1: com getItem, setItem e removeItem lançando (cota, bloqueio), nada lança", () => {
    const fail = () => {
      throw new DOMException("cheio", "QuotaExceededError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(fail);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(fail);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(fail);
    expect(readRecent()).toEqual([]);
    expect(() => recordRecent(base(1), at(1))).not.toThrow();
    expect(() => clearRecent()).not.toThrow();
  });

  it.each([
    ["JSON inválido", "{não é json"],
    ["array solto (formato antigo)", JSON.stringify([item(1)])],
    ["versão desconhecida", JSON.stringify({ version: 2, items: [item(1)] })],
    ["sem items", JSON.stringify({ version: 1 })],
    ["null", "null"],
  ])("CA4.3: %s → lista vazia", (_, raw) => {
    store(raw);
    expect(readRecent()).toEqual([]);
  });

  it.each<[string, Partial<RecentAudit> | Record<string, unknown>]>([
    ["id que não é UUID", { id: "../../admin" }],
    ["id em maiúsculas", { id: "3F2B8C1E-7A4D-4E5F-9B0C-1D2E3F4A5B6C" }],
    ["status fora do contrato", { status: "done" }],
    ["createdAt sem formato ISO", { createdAt: "12/11/2026" }],
    ["lastOpenedAt inválida", { lastOpenedAt: "2026-13-45T99:00:00Z" }],
    ["URL javascript:", { startUrl: "javascript:alert(1)" }],
    ["URL data:", { startUrl: "data:text/html,oi" }],
    ["URL que não é URL", { startUrl: "não é endereço" }],
    ["URL acima de 2.048 caracteres", { startUrl: `https://exemplo.com.br/${"a".repeat(2048)}` }],
    ["startUrl que não é texto", { startUrl: 42 }],
  ])("CA4.3: item com %s é descartado e os válidos ficam", (_, overrides) => {
    store({ version: 1, items: [item(1, overrides as Partial<RecentAudit>), item(2), "lixo", null] });
    expect(readRecent().map((r) => r.id)).toEqual([id(2)]);
  });

  it("CA4.3: campos extras não voltam a ser gravados e ids repetidos aparecem uma vez", () => {
    store({ version: 1, items: [{ ...item(1), html: "<img onerror>" }, item(1, { lastOpenedAt: at(0).toISOString() })] });
    expect(readRecent()).toEqual([item(1)]);
    recordRecent(base(2), at(2));
    expect(localStorage.getItem(RECENT_KEY)).not.toContain("onerror");
  });

  it("recordRecent ignora item inválido", () => {
    recordRecent({ ...base(1), startUrl: "javascript:alert(1)" }, at(1));
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });

  it("CA4.3: o texto exibido não tem caracteres de controle nem de direção bidi", () => {
    expect(safeText("exemplo‮.com⁦\u0007‏")).toBe("exemplo.com");
    // O `URL` codifica o bidi no caminho; ao decodificar para exibir, ele é removido.
    expect(recentLabel("https://exemplo.com.br/a‮gnp.exe")).toBe("exemplo.com.br/agnp.exe");
  });

  it("CA1.5: o endereço exibido é host e caminho, com acentos legíveis e sem a barra da raiz", () => {
    expect(recentLabel("https://exemplo.com.br/")).toBe("exemplo.com.br");
    expect(recentLabel("https://exemplo.com.br/serviços?x=1")).toBe("exemplo.com.br/serviços?x=1");
    expect(recentLabel("https://exemplo.com.br/%E0%A4%A")).toBe("exemplo.com.br/%E0%A4%A");
  });
});
