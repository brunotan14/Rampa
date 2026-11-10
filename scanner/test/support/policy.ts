import type { Resolve, SsrfPolicy } from "../../src/ssrf/policy.js";

// Nos testes, as páginas vêm de um servidor local. Ele é acessado pelo nome `fixtures`,
// liberado pela allowlist como no Compose de teste, e o DNS de teste resolve esse nome
// para 127.0.0.1. A regra não muda para nenhum outro host: `127.0.0.1` continua proibido.
//
// A allowlist pula nome e IP, mas não a porta. Como o servidor local escuta numa porta
// efêmera (a 80 exige privilégio e pode estar ocupada), a política de teste acrescenta essa
// porta às permitidas. Só ela: 8080 e qualquer outra continuam proibidas, e o padrão de
// produção (`defaultPolicy`) segue com 80 e 443.

export const notFound = (host: string) =>
  Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });

export const resolveFixtures: Resolve = async (host) => {
  if (host === "fixtures") return [{ address: "127.0.0.1", family: 4 }];
  throw notFound(host);
};

// Política dos testes: `fixtures` liberado e a porta do servidor local aceita.
export function fixturesPolicy(port: number, overrides: Partial<SsrfPolicy> = {}): Partial<SsrfPolicy> {
  return {
    allowlist: new Set(["fixtures"]),
    ports: new Set([80, 443, port]),
    resolve: resolveFixtures,
    ...overrides,
  };
}
