# Comandos do Rampa. Pré-requisitos: Elixir 1.20 / OTP 29, Node 26 (versão exata no `.nvmrc`), Docker.
COMPOSE = docker compose -f infra/docker-compose.yml

.PHONY: setup services down dev test test-backend test-frontend test-scanner e2e e2e-integrado e2e-integrado-up e2e-integrado-run e2e-integrado-down lint openapi scanner-contract

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

lint: ## Formatação, lint e tipos das três partes
	cd backend && mix format --check-formatted && mix credo --strict
	cd frontend && npm run lint && npm run typecheck
	cd scanner && npm run lint && npm run typecheck
	cd e2e && npm run typecheck

openapi: ## Regenera o contrato OpenAPI versionado (shared/openapi.json)
	cd backend && mix openapi.spec.json --spec RampaWeb.ApiSpec --pretty=true \
		--start-app=false --vendor-extensions=false --quiet ../shared/openapi.json

scanner-contract: ## Regenera os tipos do scanner a partir do contrato (shared/scanner-contract.schema.json)
	cd scanner && npm run contract
