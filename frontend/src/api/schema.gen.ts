// Gerado por `make api-types` a partir de shared/openapi.json.
// Não edite à mão: mude a API (`make openapi`) e gere de novo.

export interface paths {
    "/api/audits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cria uma auditoria
         * @description Valida a URL (RF-RA001) e a proteção contra SSRF (RF-RA002), confere os limites de taxa (por IP na última hora e o teto do dia) e cria a auditoria `queued` com a varredura da primeira página em segundo plano. No M1 a auditoria tem uma página.
         */
        post: operations["createAudit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audits/{audit_id}/findings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Achados de uma auditoria
         * @description Achados em páginas, na ordem em que foram gravados (`sort=recorded`) ou do mais grave para o menos grave, com os da mesma regra juntos (`sort=severity`). Para a próxima página, envie o `next_cursor` recebido no parâmetro `cursor`, com a mesma ordem; `null` indica a última. `total` é quantos achados passam nos filtros, só na primeira página (do instante dela); com `cursor`, `null`. Achado com `needs_review = true` é sugestão a confirmar manualmente.
         */
        get: operations["listFindings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audits/{audit_id}/findings/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Detalhe de um achado
         * @description Um achado da auditoria, com a página, as ocorrências da mesma regra (nesta página e na auditoria, na mesma lista do axe) e as outras páginas em que ela aparece. Achado de outra auditoria responde 404, como o inexistente.
         */
        get: operations["getFinding"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audits/{audit_id}/pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Páginas de uma auditoria
         * @description Todas as páginas da auditoria (no máximo 25, sem paginação), na ordem em que entraram, com as contagens de achados e de regras aprovadas. A ordenação da tela fica no cliente. Auditoria apagada pela retenção responde 404, como a inexistente.
         */
        get: operations["listPages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audits/{audit_id}/pages/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Uma página da auditoria
         * @description A página com as contagens e as regras do axe aprovadas nela (aba "Aprovados"). Regra aprovada quer dizer só que o axe não encontrou falha daquela regra nos elementos que verificou.
         */
        get: operations["getPage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audits/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Resumo de uma auditoria
         * @description Status, contadores, totais por severidade (só achados confirmados) e o erro, se a auditoria falhou.
         */
        get: operations["getAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Saúde do serviço
         * @description Confere o app, o banco e o scanner.
         */
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * AuditError
         * @description Por que a auditoria falhou: o erro da última página que falhou, com a mensagem pronta. `null` enquanto não houver falha.
         */
        AuditError: {
            /** @enum {string} */
            code: "invalid_url" | "unsupported_scheme" | "blocked_address" | "unresolvable" | "dns_error" | "resource_limit" | "timeout" | "http_error" | "navigation_failed" | "analysis_failed" | "invalid_request" | "unavailable" | "contract_mismatch" | "invalid_scan_result" | "internal_error" | "stale" | "scan_failed";
            message: string;
        } | null;
        /**
         * AuditNotFound
         * @description Auditoria inexistente, apagada pela retenção ou id que não é UUID (mesma resposta nos três casos).
         */
        AuditNotFound: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "audit_not_found";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * AuditSummary
         * @description Resumo da auditoria (RF-RA005). A pontuação e os totais são indicadores: a verificação automática não substitui a avaliação com pessoas e tecnologias assistivas.
         */
        AuditSummary: {
            error: components["schemas"]["AuditError"];
            /**
             * Format: date-time
             * @description Fim da auditoria (UTC).
             */
            finished_at: string | null;
            /** Format: uuid */
            id: string;
            /**
             * Format: date-time
             * @description Criação (UTC).
             */
            inserted_at: string;
            /** @description Achados que pedem confirmação manual (`needs_review = true`) por severidade. Não somam com `totals_by_severity` nem entram na pontuação. */
            needs_review_by_severity: components["schemas"]["SeverityTotals"];
            /** @description Achados que pedem confirmação manual (IA, heurística, incompletos). */
            needs_review_count: number;
            page_limit: number;
            pages_failed: number;
            pages_found: number;
            pages_scanned: number;
            /** @description Versão do andamento (RF-RA004). Sobe a cada mudança gravada; é a mesma dos eventos do canal `audit:<id>`. O cliente fica com o estado de maior `revision`. */
            revision: number;
            /** @description Indicador de problemas encontrados automaticamente (PRD §10.6). `null` até o M3. */
            score: number | null;
            /** @description URL inicial, já normalizada. */
            start_url: string;
            /**
             * Format: date-time
             * @description Início da varredura (UTC).
             */
            started_at: string | null;
            /**
             * @description Andamento da auditoria.
             * @enum {string}
             */
            status: "queued" | "running" | "completed" | "failed" | "cancelled";
            /** @description Até 5 regras com achados confirmados, por páginas afetadas, severidade e ocorrências. */
            top_issues: components["schemas"]["TopIssue"][];
            totals_by_severity: components["schemas"]["SeverityTotals"];
        };
        /**
         * CreateAuditRefused
         * @description Pedido recusado. `unsupported_scheme`: só http e https. `invalid_url`: endereço inválido, com credenciais ou acima de 2.048 caracteres. `blocked_address`: rede interna, nome interno ou porta fora de 80/443 ("Este endereço não pode ser auditado"). `unresolvable`: o domínio não existe. `invalid_page_limit`: fora de 1 a 25. `invalid_idempotency_key`: cabeçalho fora do formato ou repetido. `idempotency_key_reused`: a chave já foi usada por este IP, nas últimas 24 h, para outra URL (comparada depois de normalizada).
         */
        CreateAuditRefused: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "unsupported_scheme" | "invalid_url" | "blocked_address" | "unresolvable" | "invalid_page_limit" | "invalid_idempotency_key" | "idempotency_key_reused";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * CreateAuditRequest
         * @description Pedido de auditoria (RF-RA001).
         * @example {
         *       "page_limit": 1,
         *       "url": "https://exemplo.com/"
         *     }
         */
        CreateAuditRequest: {
            /**
             * @description Limite de páginas. Conferido (1 a 25), mas no M1 a auditoria tem sempre uma página; o M5 passa a usar o valor pedido.
             * @example 1
             */
            page_limit?: number;
            /**
             * @description Endereço a auditar. Só http e https; sem esquema, assume https://. Nomes internacionalizados viram punycode. Recusa credenciais, redes internas e portas diferentes de 80 e 443.
             * @example exemplo.com
             */
            url: string;
        };
        /**
         * CreateAuditResponse
         * @description Auditoria aceita; a varredura roda em segundo plano.
         * @example {
         *       "id": "3f1c2b8e-6a0d-4a7e-9d6e-1b2c3d4e5f60"
         *     }
         */
        CreateAuditResponse: {
            /** Format: uuid */
            id: string;
        };
        /**
         * DnsError
         * @description Não foi possível verificar o endereço agora (falha passageira do DNS).
         */
        DnsError: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "dns_error";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * Finding
         * @description Um problema encontrado numa página.
         */
        Finding: {
            /** @description Confiança da IA ou da heurística; `null` para o axe. */
            confidence: number | null;
            /** @description Resumo da regra, do axe (em inglês até o M3). */
            help: string | null;
            /** @description Trecho do HTML do elemento, até 2 KB. */
            html_snippet: string | null;
            /** Format: uuid */
            id: string;
            message: string | null;
            /** @description Verdadeiro para sugestões que pedem confirmação manual. */
            needs_review: boolean;
            /** Format: uuid */
            page_id: string;
            /** @example image-alt */
            rule_id: string;
            selector: string | null;
            /** @enum {string} */
            severity: "critical" | "serious" | "moderate" | "minor";
            /** @enum {string} */
            source: "axe" | "ai" | "heuristic";
            /**
             * @example [
             *       "1.1.1"
             *     ]
             */
            wcag_criteria: string[];
        };
        /**
         * FindingDetail
         * @description Um achado por inteiro (RF-RA007). Os critérios WCAG vêm só como número no M2; o título em português e o eMAG entram no M3.
         */
        FindingDetail: {
            ai_model: string | null;
            ai_reason: string | null;
            ai_suggestion: string | null;
            /** Format: uuid */
            audit_id: string;
            /** @description Versão do axe que gerou o achado; `null` para IA e heurística. */
            axe_version: string | null;
            /** @description Confiança da IA ou da heurística; `null` para o axe. */
            confidence: number | null;
            /** @description Resumo da regra, do axe (em inglês até o M3). */
            help: string | null;
            /** @description Documentação da regra no site do axe (dequeuniversity.com); `null` fora dele. */
            help_url: string | null;
            how_to_fix: string | null;
            /** @description Trecho do HTML do elemento, até 2 KB. */
            html_snippet: string | null;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            inserted_at: string;
            message: string | null;
            /** @description Verdadeiro para sugestões que pedem confirmação manual. */
            needs_review: boolean;
            /** @description Elementos afetados pela regra na página, segundo o axe. */
            nodes_total: number | null;
            /** @description Ocorrências da regra na mesma lista do axe (confirmados ou a revisar) nesta página e na auditoria. */
            occurrences: {
                audit: number;
                page: number;
            };
            /** @description Outras páginas com a mesma regra, da que tem mais ocorrências. */
            other_pages: {
                occurrences: number;
                /** Format: uuid */
                page_id: string;
                title: string | null;
                url: string;
            }[];
            page: {
                final_url: string | null;
                /** Format: uuid */
                id: string;
                title: string | null;
                url: string;
            };
            /** Format: uuid */
            page_id: string;
            prompt_version: string | null;
            /** @example image-alt */
            rule_id: string;
            selector: string | null;
            /** @enum {string} */
            severity: "critical" | "serious" | "moderate" | "minor";
            /** @enum {string} */
            source: "axe" | "ai" | "heuristic";
            /**
             * @example [
             *       "1.1.1"
             *     ]
             */
            wcag_criteria: string[];
            who_is_affected: string | null;
        };
        /**
         * FindingNotFound
         * @description `audit_not_found`: auditoria inexistente, apagada pela retenção ou id inválido. `finding_not_found`: o achado não existe nesta auditoria (inclusive o de outra auditoria).
         */
        FindingNotFound: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "audit_not_found" | "finding_not_found";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * FindingsPage
         * @description Uma página de achados.
         */
        FindingsPage: {
            data: components["schemas"]["Finding"][];
            /** @description Cursor opaco da próxima página (parâmetro `cursor`); `null` na última. */
            next_cursor: string | null;
            /** @description Quantos achados passam nos filtros, em todas as páginas da lista. Só na primeira página (sem `cursor`), do instante dela; com `cursor`, `null`. */
            total: number | null;
        };
        /**
         * FindingsQueryError
         * @description `invalid_filter`: `severity`, `source`, `needs_review`, `page_id` ou `wcag` fora dos valores aceitos. `invalid_sort`: `sort` diferente de `recorded` e `severity`. `invalid_limit`: `limit` fora de 1 a 100. `invalid_cursor`: cursor inválido, de outra ordem ou que aponta para um achado que não existe mais.
         */
        FindingsQueryError: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "invalid_filter" | "invalid_sort" | "invalid_limit" | "invalid_cursor";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * Health
         * @description Saúde do app, do banco e do scanner.
         */
        Health: {
            checks: {
                /** @enum {string} */
                app: "ok" | "error";
                /** @enum {string} */
                database: "ok" | "error";
                /** @enum {string} */
                scanner: "ok" | "error";
            };
            /** @enum {string} */
            status: "ok" | "error";
        };
        /**
         * IdempotencyConflictError
         * @description Corrida rara entre duas requisições com a mesma `Idempotency-Key`; repita o pedido.
         */
        IdempotencyConflictError: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "idempotency_conflict";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * InternalError
         * @description Erro inesperado no servidor.
         */
        InternalError: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "internal_error";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * InvalidBodyError
         * @description Corpo malformado (JSON inválido) ou sem `url` em texto.
         */
        InvalidBodyError: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "invalid_body";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * PageDetail
         * @description Uma página com as regras aprovadas (aba "Aprovados", RF-RA017).
         */
        PageDetail: {
            axe_version: string | null;
            counts_by_severity: components["schemas"]["SeverityTotals"];
            error: components["schemas"]["AuditError"];
            /** @description URL analisada, depois dos redirecionamentos. */
            final_url: string | null;
            http_status: number | null;
            /** Format: uuid */
            id: string;
            needs_review_count: number;
            /** @description Regras aprovadas; `null` quando não foram coletadas. */
            passed_count: number | null;
            /** @description Regras aprovadas, na ordem do axe. `null` quando não foram coletadas (página que falhou ou varrida antes do RF-RA017); `[]` quando nenhuma passou. */
            passed_rules: components["schemas"]["PassedRule"][] | null;
            /** Format: date-time */
            scanned_at: string | null;
            /** @enum {string} */
            status: "queued" | "scanning" | "analyzing" | "done" | "failed";
            title: string | null;
            /** @description URL pedida, já normalizada. */
            url: string;
        };
        /**
         * PageNotFound
         * @description `audit_not_found`: auditoria inexistente, apagada pela retenção ou id inválido. `page_not_found`: a página não existe nesta auditoria (inclusive a de outra auditoria).
         */
        PageNotFound: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "audit_not_found" | "page_not_found";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
            };
        };
        /**
         * PagesList
         * @description Páginas da auditoria, na ordem em que entraram (no máximo 25).
         */
        PagesList: {
            data: components["schemas"]["PageSummary"][];
        };
        /**
         * PageSummary
         * @description Uma página da auditoria com as contagens (RF-RA006).
         */
        PageSummary: {
            counts_by_severity: components["schemas"]["SeverityTotals"];
            error: components["schemas"]["AuditError"];
            /** @description URL analisada, depois dos redirecionamentos. */
            final_url: string | null;
            http_status: number | null;
            /** Format: uuid */
            id: string;
            needs_review_count: number;
            /** @description Regras aprovadas; `null` quando não foram coletadas. */
            passed_count: number | null;
            /** Format: date-time */
            scanned_at: string | null;
            /** @enum {string} */
            status: "queued" | "scanning" | "analyzing" | "done" | "failed";
            title: string | null;
            /** @description URL pedida, já normalizada. */
            url: string;
        };
        /**
         * PassedRule
         * @description Regra do axe em que nenhum elemento verificado falhou nesta página (RF-RA017). Não afirma nada sobre a página como um todo. Regra que também falhou em algum elemento da página não aparece aqui.
         */
        PassedRule: {
            /** @description Resumo da regra, do axe. */
            help: string;
            /** @description Quantos elementos o axe verificou nesta regra. */
            nodes_total: number;
            /** @example image-alt */
            rule_id: string;
            wcag_criteria: string[];
        };
        /**
         * RateLimitError
         * @description `rate_limited`: limite de auditorias por hora deste IP; a mensagem traz o horário (São Paulo, HH:MM). `daily_limit_reached`: acabou o limite do dia; vale de novo à meia-noite de São Paulo.
         */
        RateLimitError: {
            error: {
                /**
                 * @description Código estável do erro, para o cliente decidir o que fazer.
                 * @enum {string}
                 */
                code: "rate_limited" | "daily_limit_reached";
                /** @description Mensagem em português do Brasil, pronta para exibir. */
                message: string;
                /**
                 * Format: date-time
                 * @description A partir de quando dá para tentar de novo (ISO 8601, UTC).
                 */
                retry_after: string;
            };
        };
        /**
         * SeverityTotals
         * @description Achados confirmados (`needs_review = false`) por severidade, com os nomes do axe.
         */
        SeverityTotals: {
            critical: number;
            minor: number;
            moderate: number;
            serious: number;
        };
        /**
         * TopIssue
         * @description Uma das regras mais frequentes entre os achados confirmados. Ocorrências contam os elementos afetados segundo o axe, mesmo além dos 20 exemplos gravados.
         */
        TopIssue: {
            help: string | null;
            occurrences: number;
            pages_affected: number;
            /** @example image-alt */
            rule_id: string;
            /**
             * Format: uuid
             * @description O achado mais grave da regra, para abrir o detalhe.
             */
            sample_finding_id: string;
            /**
             * @description A mais grave entre os achados da regra.
             * @enum {string}
             */
            severity: "critical" | "serious" | "moderate" | "minor";
            wcag_criteria: string[];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    createAudit: {
        parameters: {
            query?: never;
            header?: {
                /** @description Chave opcional, de 1 a 128 caracteres ASCII visíveis. Repetir a mesma chave do mesmo IP em até 24 h devolve 202 com o mesmo `id`, sem criar outra auditoria nem contar no limite. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        /** @description Endereço a auditar */
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CreateAuditRequest"];
            };
        };
        responses: {
            /** @description Auditoria aceita */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateAuditResponse"];
                };
            };
            /** @description Corpo malformado ou sem `url` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidBodyError"];
                };
            };
            /** @description Mesma chave em uso por outra requisição */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdempotencyConflictError"];
                };
            };
            /** @description URL, `page_limit` ou chave recusados */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateAuditRefused"];
                };
            };
            /** @description Limite de taxa ou teto diário atingido */
            429: {
                headers: {
                    /** @description Segundos até poder tentar de novo. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitError"];
                };
            };
            /** @description Erro inesperado */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InternalError"];
                };
            };
            /** @description Não foi possível verificar o endereço agora */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DnsError"];
                };
            };
        };
    };
    listFindings: {
        parameters: {
            query?: {
                /** @description Cursor opaco devolvido em `next_cursor`, da mesma ordem. */
                cursor?: string;
                /** @description Achados por página, de 1 a 100 (padrão 50). */
                limit?: number;
                /** @description Filtra pelos achados que pedem (ou não) revisão manual. */
                needs_review?: "true" | "false";
                /** @description Filtra pelos achados de uma página da auditoria. */
                page_id?: string;
                /** @description Filtra pela severidade (nomes do axe). */
                severity?: "critical" | "serious" | "moderate" | "minor";
                /** @description Ordem: `recorded` (padrão, ordem de gravação) ou `severity` (mais grave primeiro, depois a regra). */
                sort?: "recorded" | "severity";
                /** @description Filtra pela origem do achado. */
                source?: "axe" | "ai" | "heuristic";
                /** @description Filtra pelos achados ligados a um critério WCAG. */
                wcag?: string;
            };
            header?: never;
            path: {
                /** @description Id da auditoria. */
                audit_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página de achados */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FindingsPage"];
                };
            };
            /** @description Auditoria não encontrada */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditNotFound"];
                };
            };
            /** @description Filtro, ordem, limite ou cursor inválido */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FindingsQueryError"];
                };
            };
        };
    };
    getFinding: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da auditoria. */
                audit_id: string;
                /** @description Id do achado. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Achado */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FindingDetail"];
                };
            };
            /** @description Auditoria ou achado não encontrado */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FindingNotFound"];
                };
            };
        };
    };
    listPages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da auditoria (o link do relatório). */
                audit_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Páginas */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PagesList"];
                };
            };
            /** @description Auditoria não encontrada */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditNotFound"];
                };
            };
        };
    };
    getPage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da auditoria (o link do relatório). */
                audit_id: string;
                /** @description Id da página. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Página */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageDetail"];
                };
            };
            /** @description Auditoria ou página não encontrada */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageNotFound"];
                };
            };
        };
    };
    getAudit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Id da auditoria. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Resumo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditSummary"];
                };
            };
            /** @description Auditoria não encontrada */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditNotFound"];
                };
            };
        };
    };
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tudo de pé */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            /** @description Algum componente fora do ar */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
}
