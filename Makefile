# Comandos do Rampa. Pré-requisitos: Elixir 1.20 / OTP 29, Node 24, Docker.
COMPOSE = docker compose -f infra/docker-compose.yml

.PHONY: setup services down dev test test-backend test-frontend test-scanner e2e lint

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

e2e: ## E2E com Playwright + axe
	cd e2e && npm test

lint: ## Formatação, lint e tipos das três partes
	cd backend && mix format --check-formatted && mix credo --strict
	cd frontend && npm run lint && npm run typecheck
	cd scanner && npm run lint && npm run typecheck
	cd e2e && npm run typecheck
