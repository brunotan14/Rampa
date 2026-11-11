import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CONTRACT_LIMITS as LIMITS, type AxeFacts, type AxeNode, type AxeRule, type AxeTarget, SCAN_ERROR_CODES } from "../src/contract.gen.js";
import { hasMinimumTarget, limitAxe, scanError, scanResponse, truncate, type PageFacts } from "../src/contract.js";
import { assertValid, validators } from "./support/contract.js";

// Propriedades dos cortes do contrato (`shared/scanner-contract.schema.json`, RNF-RA003): para
// qualquer resultado do axe e qualquer conteúdo da página, a resposta montada cumpre o schema e
// os limites. Os exemplos fixos ficam em `contract.test.ts`.

// Unidade de texto: qualquer ponto de código (inclusive NUL e controles), meia surrogate solta
// (o DOM permite) e os casos que já quebraram cortes: emoji (par substituto), acento combinante,
// separadores Unicode.
const unit = fc.oneof(
  fc.string({ unit: "binary", minLength: 1, maxLength: 1 }),
  fc.integer({ min: 0xd800, max: 0xdfff }).map((code) => String.fromCharCode(code)),
  fc.constantFrom("\0", "😀", "e\u0301", "\u2028", "\u3000", "\ufeff", "<", '"'),
);

// Texto às vezes enorme: um pedaço repetido passa dos limites sem gerar milhares de valores.
const text = (maxRepeat = 600) =>
  fc.oneof(
    fc.string({ unit, maxLength: 30 }),
    fc.tuple(fc.string({ unit, minLength: 1, maxLength: 12 }), fc.nat({ max: maxRepeat })).map(([piece, n]) => piece.repeat(n)),
  );

const impact = fc.constantFrom("minor", "moderate", "serious", "critical", null) as fc.Arbitrary<AxeNode["impact"]>;

// `target` em qualquer forma, inclusive vazio, nível de shadow DOM vazio e acima dos limites
// de níveis e de tamanho do seletor.
const target: fc.Arbitrary<AxeTarget> = fc.array(
  fc.oneof(text(80), fc.array(text(80), { maxLength: LIMITS.shadowLevels + 3 })),
  { maxLength: LIMITS.targetLevels + 3 },
);

const node = (maxRepeat: number): fc.Arbitrary<AxeNode> => fc
  .record({
    target,
    html: text(maxRepeat),
    failureSummary: fc.option(text(maxRepeat), { nil: null }),
    impact,
    truncated: fc.boolean(),
  })
  .map(({ truncated, ...rest }) => (truncated ? { ...rest, target_truncated: true as const } : rest));

// Regra como o coletor (`axe.ts`) entrega ou não: `nodes_total` nunca abaixo dos nós.
// `size: "max"`: sem isso o fast-check gera listas curtas (perto de 10 itens) e os cortes de 20
// nós e de 100 regras nunca seriam exercitados. `maxRepeat` deixa os textos leves quando a
// quantidade de nós é o que importa.
const rule = (maxNodes: number, maxRepeat: number): fc.Arbitrary<AxeRule> =>
  fc
    .record({
      id: fc.string({ unit, minLength: 1, maxLength: 200 }),
      impact,
      tags: fc.array(fc.oneof(fc.constantFrom("wcag2a", "wcag111", "best-practice"), text(20)), { maxLength: LIMITS.tags + 5 }),
      description: text(150),
      help: text(150),
      helpUrl: text(300),
      nodes: fc.array(node(maxRepeat), { maxLength: maxNodes, size: "max" }),
      extra: fc.nat({ max: 1000 }),
    })
    .map(({ extra, ...rule }) => ({ ...rule, nodes_total: rule.nodes.length + extra }));

const axe = (maxRules: number, maxNodes: number, maxRepeat = 600): fc.Arbitrary<AxeFacts> =>
  fc.record({
    version: fc.oneof(fc.constant("4.14.0"), fc.string({ unit, minLength: 1, maxLength: 60 })),
    violations: fc.array(rule(maxNodes, maxRepeat), { maxLength: maxRules, size: "max" }),
    incomplete: fc.array(rule(maxNodes, maxRepeat), { maxLength: maxRules, size: "max" }),
  });

const facts = (maxRules: number, maxNodes: number, maxRepeat = 600): fc.Arbitrary<PageFacts> =>
  fc.record({
    // O documento só abre por http(s) (a proteção contra SSRF recusa o resto): o schema exige.
    final_url: fc.tuple(fc.constantFrom("http://", "https://"), text()).map(([scheme, rest]) => `${scheme}${rest}`),
    http_status: fc.option(fc.integer({ min: 100, max: 399 }), { nil: null }),
    title: text(),
    axe: axe(maxRules, maxNodes, maxRepeat),
    blocked_requests: fc.nat({ max: 1_000_000 }),
  });

// Os níveis do `target` que passam dos limites (níveis de iframe, de shadow DOM, seletor).
const targetOverLimits = (value: AxeTarget) =>
  value.length > LIMITS.targetLevels ||
  value.some((level) =>
    Array.isArray(level)
      ? level.length > LIMITS.shadowLevels || level.some((selector) => selector.length > LIMITS.selector)
      : level.length > LIMITS.selector,
  );

// Só o corte de níveis do `target` (o mínimo do schema vale para o que é enviado).
const cutLevels = (value: AxeTarget): AxeTarget =>
  value.slice(0, LIMITS.targetLevels).map((level) => (Array.isArray(level) ? level.slice(0, LIMITS.shadowLevels) : level));

const codePoints = (value: string) => [...value].length;

// Entradas grandes (dezenas de regras e nós): numa falha, reduzir o contraexemplo custaria
// minutos, porque cada tentativa refaz os cortes e a validação do schema inteiro. Para no
// primeiro contraexemplo, que já mostra o defeito.
const bigInput = { endOnFailure: true } as const;

describe("cortes do contrato (propriedades)", () => {
  it("truncate devolve um prefixo com no máximo `max` unidades e pontos de código, sem par substituto partido", () => {
    fc.assert(
      fc.property(text(), fc.nat({ max: 3000 }), (value, max) => {
        const result = truncate(value, max);
        expect(value.startsWith(result)).toBe(true);
        expect(result.length).toBeLessThanOrEqual(max);
        expect(codePoints(result)).toBeLessThanOrEqual(max);
        if (value.length <= max) expect(result).toBe(value);
        else expect(result.length).toBeGreaterThanOrEqual(max - 1);
        // Corte que cairia entre as metades de um par substituto tira o par inteiro.
        const cutPair = /[\ud800-\udbff]$/.test(value.slice(0, max)) && /^[\udc00-\udfff]/.test(value.slice(max));
        if (cutPair) expect(result).toBe(value.slice(0, max - 1));
      }),
      { numRuns: 500 },
    );
  });

  it("a resposta montada sempre valida contra o schema", () => {
    fc.assert(
      fc.property(facts(3, 25), (input) => {
        assertValid(validators.response, scanResponse(input), "resposta gerada");
      }),
      { numRuns: 150, ...bigInput },
    );
  });

  it("muitas regras: corta em 100 por lista e continua válida", () => {
    fc.assert(
      fc.property(facts(LIMITS.rules + 20, 1, 10), (input) => {
        const body = scanResponse(input);
        expect(body.axe.violations).toHaveLength(Math.min(input.axe.violations.length, LIMITS.rules));
        expect(body.axe.incomplete).toHaveLength(Math.min(input.axe.incomplete.length, LIMITS.rules));
        assertValid(validators.response, body, "resposta com muitas regras");
      }),
      { numRuns: 30, ...bigInput },
    );
  });

  it("cada regra mantém a ordem, corta os nós em 20 e guarda o total em nodes_total", () => {
    fc.assert(
      fc.property(axe(3, LIMITS.nodes + 25, 40), (input) => {
        const limited = limitAxe(input);
        for (const key of ["violations", "incomplete"] as const) {
          input[key].slice(0, LIMITS.rules).forEach((original, index) => {
            const out = limited[key][index];
            expect(out).toBeDefined();
            if (out === undefined) return;

            expect(out.nodes.length).toBeLessThanOrEqual(LIMITS.nodes);
            expect(out.nodes_total).toBe(original.nodes_total);
            expect(out.nodes_total).toBeGreaterThanOrEqual(out.nodes.length);
            expect(original.id.startsWith(out.id)).toBe(true);

            // Os nós enviados são os primeiros que, depois do corte, têm o mínimo de `target`.
            const kept = original.nodes.filter((item) => hasMinimumTarget(cutLevels(item.target)));
            expect(out.nodes.map((item) => item.html)).toEqual(kept.slice(0, LIMITS.nodes).map((item) => truncate(item.html, LIMITS.html)));

            out.nodes.forEach((sent, position) => {
              const source = kept[position];
              expect(source).toBeDefined();
              if (source === undefined) return;
              expect(hasMinimumTarget(sent.target)).toBe(true);
              const truncated = targetOverLimits(source.target) || source.target_truncated === true;
              if (truncated) expect(sent.target_truncated).toBe(true);
              else expect(sent).not.toHaveProperty("target_truncated");
            });
          });
        }
      }),
      { numRuns: 150, ...bigInput },
    );
  });

  it("o erro sempre valida contra o schema, para qualquer código e detalhe", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SCAN_ERROR_CODES), text(), (code, detail) => {
        const error = scanError(code, detail);
        expect(detail.startsWith(error.detail)).toBe(true);
        assertValid(validators.error, error, "erro gerado");
      }),
      { numRuns: 200 },
    );
  });
});
