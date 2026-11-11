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

// Corta níveis de iframe, de shadow DOM e seletores longos. Cortado, o `target` deixa de
// identificar o elemento com segurança: o nó ganha `target_truncated` e quem consome (o
// backend) não o usa como seletor CSS.
function limitTarget(target: AxeTarget): { target: AxeTarget; truncated: boolean } {
  let truncated = target.length > LIMITS.targetLevels;
  const selector = (value: string) => {
    if (value.length > LIMITS.selector) truncated = true;
    return truncate(value, LIMITS.selector);
  };
  const limited = target.slice(0, LIMITS.targetLevels).map((level) => {
    if (!Array.isArray(level)) return selector(level);
    if (level.length > LIMITS.shadowLevels) truncated = true;
    return level.slice(0, LIMITS.shadowLevels).map(selector);
  });
  return { target: limited, truncated };
}

function limitNode(node: AxeNode): AxeNode {
  const { target, truncated } = limitTarget(node.target);
  return {
    target,
    html: truncate(node.html, LIMITS.html),
    failureSummary: node.failureSummary === null ? null : truncate(node.failureSummary, LIMITS.failureSummary),
    impact: node.impact,
    ...(truncated || node.target_truncated ? { target_truncated: true as const } : {}),
  };
}

// O corte de nós por regra (e o `nodes_total`) é feito na coleta (`axe.ts`, `slimRule`);
// aqui ele é repetido só por defesa, para um coletor que não corte.
function limitRule(rule: AxeRule): AxeRule {
  return {
    id: truncate(rule.id, LIMITS.ruleId),
    impact: rule.impact,
    tags: rule.tags.slice(0, LIMITS.tags).map((tag) => truncate(tag, LIMITS.tag)),
    description: truncate(rule.description, LIMITS.ruleText),
    help: truncate(rule.help, LIMITS.ruleText),
    helpUrl: truncate(rule.helpUrl, LIMITS.helpUrl),
    nodes: rule.nodes.slice(0, LIMITS.nodes).map(limitNode),
    nodes_total: rule.nodes_total,
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
