// Gera `src/contract.gen.ts` a partir do contrato canônico `shared/scanner-contract.schema.json`
// (`make scanner-contract`). O CI roda de novo e falha se o arquivo versionado estiver
// desatualizado. Nada aqui é escrito à mão: tipos, versão, códigos de erro, limites e o schema
// do pedido saem do JSON Schema.
import { readFile, writeFile } from "node:fs/promises";
import { compile, type JSONSchema } from "json-schema-to-typescript";

const schemaUrl = new URL("../../shared/scanner-contract.schema.json", import.meta.url);
const outputUrl = new URL("../src/contract.gen.ts", import.meta.url);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as { [key: string]: Json };

// Lê um valor do schema por JSON Pointer (`/definitions/AxeRule/...`); falha se não existe.
function at(pointer: string): Json {
  let node: Json = schema;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    const next: Json | undefined =
      node !== null && typeof node === "object"
        ? Array.isArray(node)
          ? node[Number(key)]
          : node[key]
        : undefined;
    if (next === undefined) throw new Error(`o schema não tem ${pointer}`);
    node = next;
  }
  return node;
}

function integerAt(pointer: string): number {
  const value = at(pointer);
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${pointer} não é inteiro`);
  return value;
}

// Limites que o scanner cumpre antes de responder (cortes em `src/contract.ts`).
const limits = {
  finalUrl: "/definitions/ScanResponse/properties/final_url/maxLength",
  title: "/definitions/ScanResponse/properties/title/maxLength",
  blockedRequests: "/definitions/ScanResponse/properties/blocked_requests/maximum",
  axeVersion: "/definitions/AxeFacts/properties/version/maxLength",
  rules: "/definitions/AxeFacts/properties/violations/maxItems",
  ruleId: "/definitions/AxeRule/properties/id/maxLength",
  tags: "/definitions/AxeRule/properties/tags/maxItems",
  tag: "/definitions/AxeRule/properties/tags/items/maxLength",
  ruleText: "/definitions/AxeRule/properties/description/maxLength",
  helpUrl: "/definitions/AxeRule/properties/helpUrl/maxLength",
  nodes: "/definitions/AxeRule/properties/nodes/maxItems",
  html: "/definitions/AxeNode/properties/html/maxLength",
  failureSummary: "/definitions/AxeNode/properties/failureSummary/maxLength",
  targetLevels: "/definitions/AxeTarget/maxItems",
  shadowLevels: "/definitions/AxeTarget/items/anyOf/1/maxItems",
  selector: "/definitions/AxeSelector/maxLength",
  detail: "/definitions/ScanError/properties/detail/maxLength",
} as const;

// Os limites com o mesmo nome no código precisam ser iguais no schema.
const sameAs: [string, keyof typeof limits][] = [
  ["/definitions/AxeFacts/properties/incomplete/maxItems", "rules"],
  ["/definitions/AxeRule/properties/help/maxLength", "ruleText"],
];
for (const [pointer, name] of sameAs) {
  if (integerAt(pointer) !== integerAt(limits[name])) throw new Error(`${pointer} difere de ${limits[name]}`);
}

const compileOptions = {
  bannerComment: "",
  additionalProperties: false,
  ignoreMinAndMaxItems: true,
  strictIndexSignatures: true,
  format: true,
  style: { printWidth: 120, singleQuote: false, trailingComma: "all" },
} as const;

// A raiz (`oneOf` das respostas) alcança todas as definições menos o pedido, que não tem
// referências e é gerado à parte.
const replyTypes = await compile(structuredClone(schema) as JSONSchema, "ScanReply", compileOptions);
const requestTypes = await compile(structuredClone(at("/definitions/ScanRequest")) as JSONSchema, "ScanRequest", compileOptions);
const types = `${replyTypes.trim()}\n\n${requestTypes.trim()}`;

// Status HTTP de cada código de erro (`x-http-status`): um para cada código do `enum`.
const errorCodes = at("/definitions/ScanErrorCode/enum");
const errorStatus = at("/definitions/ScanErrorCode/x-http-status");
if (!Array.isArray(errorCodes) || errorStatus === null || typeof errorStatus !== "object" || Array.isArray(errorStatus)) {
  throw new Error("ScanErrorCode precisa de enum e x-http-status");
}
const statusKeys = Object.keys(errorStatus).sort();
if (JSON.stringify(statusKeys) !== JSON.stringify([...errorCodes].map(String).sort())) {
  throw new Error("x-http-status precisa ter exatamente os códigos do enum");
}

const json = (value: unknown) => JSON.stringify(value, null, 2);
const limitValues = Object.fromEntries(Object.entries(limits).map(([name, pointer]) => [name, integerAt(pointer)]));

const output = `// Gerado por \`make scanner-contract\` a partir de shared/scanner-contract.schema.json.
// Não edite à mão: mude o schema e gere de novo.

${types.trim()}

export const CONTRACT_VERSION = ${json(at("/definitions/ContractVersion/const"))} as const;

export const SCAN_ERROR_CODES = ${json(errorCodes)} as const satisfies readonly ScanErrorCode[];

// Status HTTP de cada código de erro (\`x-http-status\` no schema).
export const SCAN_ERROR_STATUS = ${json(errorStatus)} as const satisfies Record<ScanErrorCode, number>;

// Limites do contrato que o scanner cumpre cortando antes de responder.
export const CONTRACT_LIMITS = ${json(limitValues)} as const;

// Schema do corpo de POST /scan, para a validação do Fastify.
export const SCAN_REQUEST_SCHEMA = ${json(at("/definitions/ScanRequest"))} as const;
`;

await writeFile(outputUrl, output);
