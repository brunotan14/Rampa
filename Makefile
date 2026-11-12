# Comandos do Rampa. Pré-requisitos: Elixir 1.20 / OTP 29, Node 26 (versão exata no `.nvmrc`), Docker.
COMPOSE = docker compose -f infra/docker-compose.yml
comma := ,
# `FULL=1` e `NPM_CI=1` ligam as opções do `make ci`; qualquer outro valor (0, false) deixa desligado.
full := $(filter 1,$(FULL))
npm_ci := $(filter 1,$(NPM_CI))

.PHONY: setup services down dev test test-backend test-load test-frontend test-scanner e2e e2e-integrado e2e-integrado-up e2e-integrado-run e2e-integrado-down lint lint-backend lint-frontend lint-scanner lint-e2e ci openapi scanner-contract api-types

setup: services ## Instala dependências e prepara o banco
	cd backend && mix deps.get && mix ecto.setup
	cd frontend && npm ci
	cd scanner && npm ci && npx playwright install chromium
	cd e2e && npm ci && npx playwright install chromium

services: ## Sobe banco e scanner em containers
	$(COMPOSE) up -d --build --wait

down: ## Para os containers
	$(COMPOSE) down

dev: services ## Sobe tudo: banco e scanner (Docker), Phoenix em :4000, Vite em :5173
	@trap 'kill 0' EXIT; \
	(cd backend && mix phx.server) & \
	(cd frontend && npm run dev) & \
	wait

test: test-backend test-frontend test-scanner ## Testes unitários das três partes

test-backend:
	cd backend && mix test

test-load: ## Teste de carga do relatório (100 mil achados; fora do `make test`)
	cd backend && mix test --only load

test-frontend:
	cd frontend && npm test

test-scanner:
	cd scanner && npm test

e2e: ## E2E das telas do Rampa (Playwright + axe)
	cd e2e && npm test

# E2E integrado (PRD §11.4): Compose de teste com app, scanner, banco e fixtures. ARGS vai
# para o Playwright, ex.: make e2e-integrado ARGS="-g fumaça".
e2e-integrado: ## E2E integrado: sobe o Compose de teste, roda e2e/integrado e derruba
	infra/test/run-e2e.sh $(ARGS)

e2e-integrado-up: ## Constrói e sobe o Compose de teste, e deixa de pé
	infra/test/run-e2e.sh up

e2e-integrado-run: ## Roda os specs de e2e/integrado no Compose de teste de pé
	infra/test/run-e2e.sh run $(ARGS)

e2e-integrado-down: ## Guarda os logs e derruba o Compose de teste
	infra/test/run-e2e.sh down

lint: lint-backend lint-frontend lint-scanner lint-e2e ## Formatação, lint e tipos (backend, frontend, scanner e e2e)

lint-backend:
	cd backend && mix format --check-formatted && mix credo --strict

lint-frontend:
	cd frontend && npm run lint && npm run typecheck

lint-scanner:
	cd scanner && npm run lint && npm run typecheck

lint-e2e:
	cd e2e && npm run typecheck

# Os passos dos jobs de `.github/workflows/ci.yml`, na mesma ordem, parando no primeiro erro.
# Precisa do banco de pé (`make services`) e do Node do `.nvmrc` (`nvm use`): Node diferente
# falha logo no começo; Erlang/OTP ou Elixir diferentes do CI só geram aviso. O backend roda
# com MIX_ENV=test, como no CI. Fica de fora a revisão de dependências, que só existe em PR.
#   NPM_CI=1  reinstala as dependências npm com `npm ci` antes de cada parte, como o CI (por
#             padrão usa o node_modules que já está instalado);
#   FULL=1    roda também os E2E (`make e2e` e `make e2e-integrado`, que precisa do Docker).
ci: ## Passos do CI na ordem do ci.yml (FULL=1: também os E2E; NPM_CI=1: `npm ci` antes)
	infra/ci/check-toolchain.sh
	@echo "==> Backend (format, credo, ExUnit)"
	cd backend && MIX_ENV=test mix deps.get && MIX_ENV=test mix compile --warnings-as-errors
	MIX_ENV=test $(MAKE) --no-print-directory lint-backend
	MIX_ENV=test $(MAKE) --no-print-directory test-backend
	MIX_ENV=test infra/ci/check-contract.sh openapi
	@echo "==> Frontend (lint, tipos, Vitest)"
	$(if $(npm_ci),cd frontend && npm ci)
	infra/ci/check-contract.sh frontend
	$(MAKE) --no-print-directory lint-frontend
	$(MAKE) --no-print-directory test-frontend
	@echo "==> Scanner (lint, tipos, Vitest)"
	$(if $(npm_ci),cd scanner && npm ci)
	infra/ci/check-contract.sh scanner
	$(MAKE) --no-print-directory lint-scanner
	$(MAKE) --no-print-directory test-scanner
	@echo "==> E2E (tipos$(if $(full),$(comma) Playwright + axe))"
	$(if $(npm_ci),cd e2e && npm ci)
	$(MAKE) --no-print-directory lint-e2e
	$(if $(full),$(MAKE) --no-print-directory e2e)
	$(if $(full),@echo "==> E2E integrado (API + scanner)")
	$(if $(full),$(MAKE) --no-print-directory e2e-integrado)
	@echo "==> make ci: tudo verde$(if $(full),, (sem os E2E; FULL=1 roda também))"

openapi: ## Regenera o contrato OpenAPI versionado (shared/openapi.json)
	cd backend && mix openapi.spec.json --spec RampaWeb.ApiSpec --pretty=true \
		--start-app=false --vendor-extensions=false --quiet ../shared/openapi.json

scanner-contract: ## Regenera os tipos do scanner a partir do contrato (shared/scanner-contract.schema.json)
	cd scanner && npm run contract

api-types: ## Regenera os tipos do frontend a partir da API (shared/openapi.json) e do canal (shared/channel-events.schema.json)
	cd frontend && npm run api-types
