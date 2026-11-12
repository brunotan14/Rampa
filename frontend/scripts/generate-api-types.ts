// Gera os tipos do frontend a partir dos contratos versionados (`make api-types`):
//   - src/api/schema.gen.ts   ← shared/openapi.json (API REST, openapi-typescript);
//   - src/api/channel.gen.ts  ← shared/channel-events.schema.json (canal `audit:<id>`,
//                               json-schema-to-typescript, o mesmo gerador do scanner).
// O CI regenera (`infra/ci/check-contract.sh frontend`) e falha se o versionado estiver
// desatualizado. Nada nesses arquivos é escrito à mão.
import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";
import { compile, type JSONSchema } from "json-schema-to-typescript";

const shared = (name: string) => new URL(`../../shared/${name}`, import.meta.url);
const output = (name: string) => new URL(`../src/api/${name}`, import.meta.url);

// --- API REST ---------------------------------------------------------------------------
const openapi = astToString(await openapiTS(shared("openapi.json"), { alphabetize: true }));
await writeFile(
  output("schema.gen.ts"),
  `// Gerado por \`make api-types\` a partir de shared/openapi.json.
// Não edite à mão: mude a API (\`make openapi\`) e gere de novo.

${openapi.trim()}
`,
);

// --- Canal audit:<id> -------------------------------------------------------------------
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json };

const channel = JSON.parse(await readFile(shared("channel-events.schema.json"), "utf8")) as Schema;

function record(value: Json | undefined, name: string): { [key: string]: Json } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} precisa ser um objeto`);
  return value;
}

function ref(value: Json | undefined, name: string): string {
  if (typeof value !== "string" || !value.startsWith("#/definitions/")) throw new Error(`${name} precisa apontar para #/definitions/`);
  return value;
}

const events = record(channel["x-events"], "x-events");
const join = record(channel["x-join"], "x-join");
const version = channel["x-channel-version"];
if (typeof version !== "string") throw new Error("x-channel-version precisa ser texto");

// Um tipo raiz que liga cada evento (e as respostas do join) ao seu payload: assim o
// gerador emite todas as definições com nome, e o mapa de eventos sai do próprio schema.
const eventNames = Object.keys(events).sort();
const root = {
  title: "AuditChannelPayloads",
  description: "Payload de cada evento do canal `audit:<id>` (`x-events`) e das respostas do join (`x-join`).",
  type: "object",
  additionalProperties: false,
  required: ["join_reply", "join_error", ...eventNames],
  properties: {
    join_reply: { $ref: ref(join["reply"], "x-join.reply") },
    join_error: { $ref: ref(join["error"], "x-join.error") },
    ...Object.fromEntries(eventNames.map((name) => [name, { $ref: ref(events[name], `x-events.${name}`) }])),
  },
  definitions: channel["definitions"],
};

const types = await compile(root as JSONSchema, "AuditChannelPayloads", {
  bannerComment: "",
  additionalProperties: false,
  strictIndexSignatures: true,
  format: true,
  style: { printWidth: 120, singleQuote: false, trailingComma: "all" },
});

const json = (value: unknown) => JSON.stringify(value, null, 2);

await writeFile(
  output("channel.gen.ts"),
  `// Gerado por \`make api-types\` a partir de shared/channel-events.schema.json.
// Não edite à mão: mude o schema e gere de novo.

${types.trim()}

// \`x-channel-version\`: sobe só em mudança incompatível do canal.
export const CHANNEL_VERSION = ${json(version)} as const;

// Tópico do canal (\`x-topic\`), com \`<id>\` no lugar do id da auditoria.
export const CHANNEL_TOPIC = ${json(channel["x-topic"])} as const;

// Eventos do canal (\`x-events\`). O cliente ignora evento que não está aqui.
export const CHANNEL_EVENTS = ${json(eventNames)} as const satisfies readonly (keyof AuditChannelPayloads)[];

export type AuditChannelEvent = (typeof CHANNEL_EVENTS)[number];
`,
);
