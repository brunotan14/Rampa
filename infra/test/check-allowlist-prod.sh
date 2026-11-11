#!/usr/bin/env bash
# RF-RA002, critério de aceite: "Dado a configuração de produção com SSRF_ALLOWLIST
# preenchida, quando o app inicia, então ele não sobe e registra um erro explicando o motivo."
#
# Sobe a release de PRODUÇÃO (`rampa-e2e-app-prod`, MIX_ENV=prod) sem rede, com todas as
# variáveis obrigatórias (fictícias):
#   1. com SSRF_ALLOWLIST=fixtures: precisa sair com código diferente de zero e registrar o
#      motivo no log;
#   2. controle, com a SSRF_ALLOWLIST vazia: precisa subir o endpoint. Prova que a recusa do
#      passo 1 vem da allowlist, e não de outra configuração faltando.
# O mesmo para o scanner com NODE_ENV=production (RF-RA002).
set -euo pipefail

APP_IMAGE=${APP_PROD_IMAGE:-rampa-e2e-app-prod}
SCANNER_IMAGE=${SCANNER_IMAGE:-rampa-e2e-scanner}
TIMEOUT_S=60
REFUSAL="SSRF_ALLOWLIST está preenchida em produção"

# Fictícios, só de teste. O banco e o scanner não existem (`--network none`): o app sobe
# mesmo assim e registra as falhas de conexão.
APP_ENV=(
  -e DATABASE_URL=ecto://postgres:postgres@127.0.0.1:1/rampa
  -e SECRET_KEY_BASE=teste-prod-secret-key-base-ficticio-nao-usar-em-producao-0123456789abcdef
  -e IP_HASH_SECRET=teste-prod-ip-hash-secret-ficticio-nao-usar-em-producao
  -e PHX_HOST=localhost
  -e TRUSTED_PROXIES=127.0.0.1/32
  -e SCANNER_URL=http://127.0.0.1:1
)

containers=()
cleanup() {
  for name in "${containers[@]+"${containers[@]}"}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# `start <nome> <args do docker run>`: sobe o container sem rede e o registra para a limpeza.
start() {
  local name=$1
  shift
  containers+=("$name")
  docker run -d --pull never --network none --name "$name" "$@" >/dev/null
}

running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$1")" = "true" ]
}

# O container precisa terminar sozinho, com código diferente de zero e `$2` no log.
expect_refusal() {
  local name=$1 message=$2 waited=0
  while running "$name"; do
    if [ "$waited" -ge "$TIMEOUT_S" ]; then
      echo "FALHOU: $name continua de pé depois de ${TIMEOUT_S}s" >&2
      docker logs "$name" >&2 || true
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  local code
  code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
  if [ "$code" -eq 0 ]; then
    echo "FALHOU: $name saiu com código 0" >&2
    docker logs "$name" >&2 || true
    return 1
  fi
  if ! docker logs "$name" 2>&1 | grep -qF "$message"; then
    echo "FALHOU: o log de $name não explica o motivo (\"$message\")" >&2
    docker logs "$name" >&2 || true
    return 1
  fi
  echo "ok: $name recusou a subida (código $code) e registrou: $message"
}

# O container precisa escrever `$2` no log e continuar de pé.
expect_running() {
  local name=$1 message=$2 waited=0
  until docker logs "$name" 2>&1 | grep -qF "$message"; do
    if ! running "$name" || [ "$waited" -ge "$TIMEOUT_S" ]; then
      echo "FALHOU: $name não subiu (esperava \"$message\" no log)" >&2
      docker logs "$name" >&2 || true
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  running "$name" || {
    echo "FALHOU: $name caiu depois de subir" >&2
    return 1
  }
  echo "ok: $name subiu sem a allowlist (controle)"
}

prefix="rampa-check-$$"

echo "App de produção ($APP_IMAGE)"
start "$prefix-app-allowlist" "${APP_ENV[@]}" -e SSRF_ALLOWLIST=fixtures "$APP_IMAGE"
start "$prefix-app-control" "${APP_ENV[@]}" -e SSRF_ALLOWLIST= "$APP_IMAGE"
expect_refusal "$prefix-app-allowlist" "$REFUSAL"
expect_running "$prefix-app-control" "Running RampaWeb.Endpoint"

echo "Scanner de produção ($SCANNER_IMAGE)"
start "$prefix-scanner-allowlist" -e NODE_ENV=production -e SSRF_ALLOWLIST=fixtures "$SCANNER_IMAGE"
start "$prefix-scanner-control" -e NODE_ENV=production -e SSRF_ALLOWLIST= "$SCANNER_IMAGE"
expect_refusal "$prefix-scanner-allowlist" "$REFUSAL"
expect_running "$prefix-scanner-control" "Server listening"
