import {
  CONTRACT_LIMITS as LIMITS,
  CONTRACT_VERSION,
  type AxeFacts,
  type AxeNode,
  type AxeRule,
  type AxeTarget,
  type ScanError,
  type ScanErrorCode,
  type ScanResponse,
} from "./contract.gen.js";

// Cortes que mantêm toda resposta dentro dos limites do contrato
// (`shared/scanner-contract.schema.json`). O que vem da página não tem tamanho máximo (um
// título de 1 MB, milhares de nós numa regra), e o scanner, que divide a VPS com o resto do
// Rampa (RNF-RA003), não pode mandar ao backend um corpo sem teto. Os valores saem do schema
// via `contract.gen.ts`.

// Corta em no máximo `max` unidades UTF-16 sem separar um par substituto: o resultado tem
// no máximo `max` pontos de código (o que o `maxLength` do JSON Schema conta).
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

const selector = (value: string) => truncate(value, LIMITS.selector);

function limitTarget(target: AxeTarget): AxeTarget {
  return target
    .slice(0, LIMITS.targetLevels)
    .map((level) => (Array.isArray(level) ? level.slice(0, LIMITS.shadowLevels).map(selector) : selector(level)));
}

function limitNode(node: AxeNode): AxeNode {
  return {
    target: limitTarget(node.target),
    html: truncate(node.html, LIMITS.html),
    failureSummary: node.failureSummary === null ? null : truncate(node.failureSummary, LIMITS.failureSummary),
    impact: node.impact,
  };
}

// Só os primeiros nós; `nodes_total` guarda quantos a regra tinha.
function limitRule(rule: AxeRule): AxeRule {
  return {
    id: truncate(rule.id, LIMITS.ruleId),
    impact: rule.impact,
    tags: rule.tags.slice(0, LIMITS.tags).map((tag) => truncate(tag, LIMITS.tag)),
    description: truncate(rule.description, LIMITS.ruleText),
    help: truncate(rule.help, LIMITS.ruleText),
    helpUrl: truncate(rule.helpUrl, LIMITS.helpUrl),
    nodes: rule.nodes.slice(0, LIMITS.nodes).map(limitNode),
    nodes_total: Math.max(rule.nodes_total, rule.nodes.length),
  };
}

export function limitAxe(axe: AxeFacts): AxeFacts {
  return {
    version: truncate(axe.version, LIMITS.axeVersion),
    violations: axe.violations.slice(0, LIMITS.rules).map(limitRule),
    incomplete: axe.incomplete.slice(0, LIMITS.rules).map(limitRule),
  };
}

export interface PageFacts {
  final_url: string;
  http_status: number | null;
  title: string;
  axe: AxeFacts;
  blocked_requests: number;
}

// Resposta de sucesso com a versão do contrato e os cortes.
export function scanResponse(facts: PageFacts): ScanResponse {
  return {
    contract_version: CONTRACT_VERSION,
    final_url: truncate(facts.final_url, LIMITS.finalUrl),
    http_status: facts.http_status,
    title: truncate(facts.title, LIMITS.title),
    axe: limitAxe(facts.axe),
    blocked_requests: Math.min(facts.blocked_requests, LIMITS.blockedRequests),
  };
}

// Resposta de erro com a versão do contrato; o `detail` (mensagens do Playwright podem trazer
// o log inteiro da chamada) é cortado.
export function scanError(error: ScanErrorCode, detail: string): ScanError {
  return { contract_version: CONTRACT_VERSION, error, detail: truncate(detail, LIMITS.detail) };
}
