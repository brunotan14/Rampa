// Gerado por `make scanner-contract` a partir de shared/scanner-contract.schema.json.
// Não edite à mão: mude o schema e gere de novo.

/**
 * Contrato entre o backend (Phoenix) e o scanner (PRD §7), fonte única da verdade. O scanner gera os tipos TypeScript a partir dele (`make scanner-contract`, `scanner/src/contract.gen.ts`) e os testes validam as respostas reais de POST /scan; o backend o embute na compilação (`Rampa.Scanner.Contract`) e valida toda resposta antes de gravar. A raiz descreve o corpo de uma resposta de POST /scan com código do contrato: `ScanResponse` (HTTP 200) ou `ScanError`. O erro de validação do pedido (HTTP 400 do Fastify) fica fora do contrato.
 */
export type ScanReply = ScanResponse | ScanError;
/**
 * Versão do contrato. Presente em toda resposta, de sucesso ou de erro.
 */
export type ContractVersion = "1";
/**
 * Impacto segundo o axe; `null` quando o axe não informa (comum em `incomplete`).
 */
export type AxeImpact = "minor" | "moderate" | "serious" | "critical" | null;
export type AxeSelector = string;
/**
 * Seletores do elemento: um item por nível de iframe, do documento principal para dentro. Um item que é lista indica shadow DOM, do host para dentro. No máximo 8 níveis de cada, com seletores de até 512 caracteres.
 *
 * @minItems 1
 * @maxItems 8
 */
export type AxeTarget = (AxeSelector | AxeSelector[])[];
/**
 * Códigos de erro do scanner, com o status HTTP de cada um. `blocked_address` (422): a URL, um salto de redirecionamento do documento ou uma navegação do documento principal vai para endereço proibido ou porta fora de 80/443. `invalid_url` (422): URL com credenciais ou host inválido. `resource_limit` (422): a varredura passou do teto de dados ou de conexões simultâneas do proxy de saída. `timeout` (504): a página não carregou em 30 s ou a análise passou do limite total. `http_error` (502): o documento respondeu com status >= 400 (`detail`: "HTTP 404"); o axe não roda. `navigation_failed` (502): a página não abriu. `analysis_failed` (502): a página abriu, mas a coleta falhou depois (axe, título, contexto destruído).
 */
export type ScanErrorCode =
  | "blocked_address"
  | "invalid_url"
  | "resource_limit"
  | "timeout"
  | "http_error"
  | "navigation_failed"
  | "analysis_failed";

/**
 * Resposta de sucesso (HTTP 200): fatos sobre a página. O scanner corta o que vem da página nos limites deste schema antes de responder (RNF-RA003); o backend ainda corta o que grava (RNF-RA005).
 */
export interface ScanResponse {
  contract_version: ContractVersion;
  /**
   * URL analisada, depois dos redirecionamentos e da navegação que a página dispara sozinha. Cortada em 8192 caracteres.
   */
  final_url: string;
  /**
   * Status HTTP do documento analisado; `null` se o navegador não informou. Status >= 400 não chega aqui: vira o erro `http_error`.
   */
  http_status: number | null;
  /**
   * Título da página, cortado em 512 caracteres (o backend grava até 512 bytes, então nada do que ele guardaria se perde).
   */
  title: string;
  axe: AxeFacts;
  /**
   * Requisições fora do documento principal recusadas pela proteção contra SSRF (endereço, nome ou porta), no route ou só no proxy, cada uma contada uma vez. Satura em 10000.
   */
  blocked_requests: number;
}
/**
 * Resultado do axe-core (RF-RA003), só com os campos do contrato. O scanner não decide severidade.
 */
export interface AxeFacts {
  version: string;
  /**
   * Regras que falharam. O axe roda 70 regras com as tags do RF-RA003; o teto é folga.
   *
   * @maxItems 100
   */
  violations: AxeRule[];
  /**
   * Regras que o axe não conseguiu decidir (viram achados com `needs_review`).
   *
   * @maxItems 100
   */
  incomplete: AxeRule[];
}
/**
 * Uma regra do axe com os nós afetados. Os textos (`description`, `help`, `helpUrl`, `tags`) são do axe, não da página.
 */
export interface AxeRule {
  id: string;
  impact: AxeImpact;
  /**
   * @maxItems 64
   */
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  /**
   * Os primeiros 20 nós afetados, na ordem do axe. 20 exemplos bastam para localizar o problema no relatório; a pontuação conta regras, não nós (PRD §10.6).
   *
   * @maxItems 20
   */
  nodes: AxeNode[];
  /**
   * Quantos nós a regra tinha antes do corte em `nodes`.
   */
  nodes_total: number;
}
/**
 * Um elemento afetado. `html`, `target` e `failureSummary` trazem conteúdo da página e têm limite.
 */
export interface AxeNode {
  target: AxeTarget;
  /**
   * HTML do elemento, cortado em 2048 caracteres. Um caractere ocupa pelo menos um byte, então o corte do backend em 2 KB (RNF-RA005) continua igual.
   */
  html: string;
  /**
   * Resumo do axe sobre o que falhou; pode citar valores de atributos da página. Cortado em 2048 caracteres.
   */
  failureSummary: string | null;
  impact: AxeImpact;
}
/**
 * Resposta de erro (HTTP 422, 502 ou 504, conforme o código).
 */
export interface ScanError {
  contract_version: ContractVersion;
  error: ScanErrorCode;
  /**
   * Explicação técnica para log, em texto livre; pode citar a página. Cortada em 2048 caracteres.
   */
  detail: string;
}

/**
 * Corpo de POST /scan. O scanner valida o pedido com este schema; campo desconhecido é descartado.
 */
export interface ScanRequest {
  /**
   * URL a varrer, já validada pelo backend (RF-RA002). O scanner confere de novo.
   */
  url: string;
  /**
   * Reservado para as análises do M4 (PRD §7). Ignorado pelo scanner na versão 1.
   */
  options?: {
    tab_limit?: number;
    max_images?: number;
  };
}

export const CONTRACT_VERSION = "1" as const;

export const SCAN_ERROR_CODES = [
  "blocked_address",
  "invalid_url",
  "resource_limit",
  "timeout",
  "http_error",
  "navigation_failed",
  "analysis_failed"
] as const satisfies readonly ScanErrorCode[];

// Limites do contrato que o scanner cumpre cortando antes de responder.
export const CONTRACT_LIMITS = {
  "finalUrl": 8192,
  "title": 512,
  "blockedRequests": 10000,
  "axeVersion": 32,
  "rules": 100,
  "ruleId": 128,
  "tags": 64,
  "tag": 64,
  "ruleText": 1024,
  "helpUrl": 2048,
  "nodes": 20,
  "html": 2048,
  "failureSummary": 2048,
  "targetLevels": 8,
  "shadowLevels": 8,
  "selector": 512,
  "detail": 2048
} as const;

// Schema do corpo de POST /scan, para a validação do Fastify.
export const SCAN_REQUEST_SCHEMA = {
  "title": "ScanRequest",
  "description": "Corpo de POST /scan. O scanner valida o pedido com este schema; campo desconhecido é descartado.",
  "type": "object",
  "required": [
    "url"
  ],
  "additionalProperties": false,
  "properties": {
    "url": {
      "description": "URL a varrer, já validada pelo backend (RF-RA002). O scanner confere de novo.",
      "type": "string",
      "pattern": "^https?://",
      "maxLength": 2048
    },
    "options": {
      "description": "Reservado para as análises do M4 (PRD §7). Ignorado pelo scanner na versão 1.",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "tab_limit": {
          "type": "integer",
          "minimum": 1
        },
        "max_images": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  }
} as const;
