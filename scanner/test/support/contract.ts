import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

// Validação das respostas reais de POST /scan contra o contrato canônico
// (`shared/scanner-contract.schema.json`, draft-07). Todo teste que chama /scan passa por
// `scanOn`, então cada sucesso e cada erro que os testes produzem é conferido.

export const contractSchema = JSON.parse(
  readFileSync(new URL("../../../shared/scanner-contract.schema.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

// `strict`: palavra-chave desconhecida ou mal usada no schema é erro.
const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true });
ajv.addSchema(contractSchema, "contract");

const compileRef = (ref: string): ValidateFunction => ajv.compile({ $ref: `contract${ref}` });

export const validators = {
  reply: compileRef("#"),
  response: compileRef("#/definitions/ScanResponse"),
  error: compileRef("#/definitions/ScanError"),
  request: compileRef("#/definitions/ScanRequest"),
};

// Status HTTP de cada código, como descrito em `ScanErrorCode` no schema.
export const ERROR_STATUS: Record<string, number> = {
  blocked_address: 422,
  invalid_url: 422,
  resource_limit: 422,
  timeout: 504,
  http_error: 502,
  navigation_failed: 502,
  analysis_failed: 502,
};

// Falha com a lista de erros do ajv se o corpo não cumpre o schema.
export function assertValid(validate: ValidateFunction, body: unknown, label: string): void {
  if (!validate(body)) {
    throw new Error(`${label} fora do contrato: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  }
}

// Confere uma resposta de /scan: 200 é `ScanResponse`; 422/502/504 é `ScanError` com o status
// do código. 400 é a validação do pedido pelo Fastify, fora do contrato.
export function assertContract(res: LightMyRequestResponse): void {
  if (res.statusCode === 400) return;
  const body: unknown = res.json();
  if (res.statusCode === 200) return assertValid(validators.response, body, "resposta 200");
  assertValid(validators.error, body, `resposta ${res.statusCode}`);
  const { error } = body as { error: string };
  if (ERROR_STATUS[error] !== res.statusCode) {
    throw new Error(`erro ${error} veio com HTTP ${res.statusCode}, o contrato diz ${ERROR_STATUS[error]}`);
  }
}

export async function scanOn(server: FastifyInstance, url: string): Promise<LightMyRequestResponse> {
  const res = await server.inject({ method: "POST", url: "/scan", payload: { url } });
  assertContract(res);
  return res;
}
