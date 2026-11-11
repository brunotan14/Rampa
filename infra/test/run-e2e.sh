#!/usr/bin/env bash
# E2E integrado (PRD §11.2 e §11.4): constrói as imagens, prova que a release de produção
# recusa a SSRF_ALLOWLIST, sobe o Compose de teste, confere o isolamento de rede do scanner e
# roda os specs de `e2e/integrado/`. No fim guarda os logs dos containers e derruba tudo.
# Sai com o código do primeiro passo que falhar (ou o do Playwright).
#
#   infra/test/run-e2e.sh [args do playwright]   ciclo completo (`make e2e-integrado`)
#   infra/test/run-e2e.sh up                     constrói e sobe, e deixa de pé
#   infra/test/run-e2e.sh run [args]             roda os specs no ambiente de pé
#   infra/test/run-e2e.sh down                   guarda os logs e derruba
#
# Saída em `e2e/test-results/integrado/`: `report/` (HTML), `artifacts/` (traces das falhas)
# e `logs/` (logs dos containers).
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f infra/docker-compose.test.yml)
OUT=e2e/test-results/integrado
RUNNER="rampa-e2e-runner-$$"

step() {
  printf '\n==> %s\n' "$*"
}

timed() {
  local label=$1
  shift
  local start=$SECONDS
  "$@"
  printf '==> %s: %ss\n' "$label" "$((SECONDS - start))"
}

build() {
  step "Construindo as imagens (app e2e, app prod, scanner, fixtures, runner)"
  "${COMPOSE[@]}" --profile e2e --profile check build
}

up() {
  step "Subindo o Compose de teste"
  "${COMPOSE[@]}" up -d --wait --wait-timeout 300 app app-daily fixtures
}

# Roda o runner (com nome, sem `--rm`) e copia a saída dele para o host mesmo em falha.
run_specs() {
  local status=0
  step "Rodando os specs de e2e/integrado"
  "${COMPOSE[@]}" run --name "$RUNNER" e2e "$@" || status=$?
  mkdir -p "$OUT"
  rm -rf "$OUT/report" "$OUT/artifacts"
  docker cp "$RUNNER:/e2e/out/." "$OUT/" >/dev/null 2>&1 || echo "aviso: sem saída do Playwright para copiar" >&2
  docker rm -f "$RUNNER" >/dev/null 2>&1 || true
  return "$status"
}

# Logs de todos os containers do projeto. Sem containers (já derrubado), mantém os que
# já foram guardados.
collect_logs() {
  if [ -z "$("${COMPOSE[@]}" --profile e2e --profile check ps -aq 2>/dev/null)" ]; then
    return 0
  fi
  mkdir -p "$OUT/logs"
  "${COMPOSE[@]}" ps -a >"$OUT/logs/ps.txt" 2>&1 || true
  "${COMPOSE[@]}" logs --no-color --timestamps >"$OUT/logs/compose.log" 2>&1 || true
}

down() {
  "${COMPOSE[@]}" --profile e2e --profile check down -v --remove-orphans
}

# Sempre, com sucesso ou falha: guarda os logs, derruba e mantém o código de saída.
finish() {
  local status=$?
  collect_logs
  step "Derrubando o Compose de teste"
  down >/dev/null 2>&1 || true
  exit "$status"
}

all() {
  rm -rf "$OUT"
  mkdir -p "$OUT"
  trap finish EXIT
  timed "build" build
  timed "allowlist em produção" infra/test/check-allowlist-prod.sh
  timed "subida" up
  timed "isolamento de rede" infra/test/check-network-isolation.sh
  timed "specs" run_specs "$@"
}

case "${1:-}" in
  up)
    build
    up
    ;;
  run)
    shift
    # Só o runner: os specs entram na imagem dele, e o resto já está de pé.
    "${COMPOSE[@]}" --profile e2e build e2e
    run_specs "$@"
    ;;
  down)
    collect_logs
    down
    ;;
  *)
    all "$@"
    ;;
esac
