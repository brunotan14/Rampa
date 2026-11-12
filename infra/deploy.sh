#!/usr/bin/env bash
# Deploy do Rampa na VPS (PRD §7, Hospedagem e deploy). Instalado UMA vez, à mão, em
# `/opt/rampa/deploy.sh` (dono `deploy`, 750); o GitHub Actions o chama pelo SSH do usuário
# `deploy`, cujo comando forçado só aceita `deploy <sha de 40 hex>` e faz
# `exec /opt/rampa/deploy.sh <sha>`. Este script é o "bootstrap": o Compose de produção viaja
# dentro da imagem do app (`/app/deploy/docker-compose.prod.yml`) e é extraído a cada deploy, então
# só uma mudança AQUI pede reinstalação (e sobe o `x-bootstrap-version` do Compose junto).
#
#   /opt/rampa/deploy.sh <sha>
#
# Passos, sob uma trava (um deploy por vez, inclusive o rollback):
#   1. confere o espaço em disco, baixa `rampa-app:<sha>` e `rampa-scanner:<sha>` do registro
#      e extrai o Compose da imagem do app para `/opt/rampa/releases/<sha>/`;
#   2. `postgres` de pé → `bin/migrate` (com o app antigo ainda no ar) → `scanner` → `app`,
#      cada um esperando o healthcheck do Compose;
#   3. confere o caminho pelo Traefik, em `https://$PHX_HOST/api/health`: sem credencial tem de
#      dar 401 (certificado válido e basic auth no ar) e com a `RAMPA_HEALTHCHECK_AUTH` tem de
#      dar 200 (o Traefik alcança o app novo, e o app, o banco e o scanner);
#   4. deu certo: grava `current` e `previous` e apaga as releases e imagens antigas (ficam 3).
#      Falhou em 2 ou 3: volta para a versão de `current`, com o Compose e a etiqueta dela,
#      e sai com erro (o job do Actions fica vermelho). Sem versão anterior (primeiro
#      deploy), só sai com erro.
#
# As migrations não voltam no rollback: toda migration precisa ser compatível com a versão
# anterior do app (expandir antes, contrair num deploy seguinte).
#
# Rollback manual: o mesmo comando com o sha anterior (`workflow_dispatch` do
# `.github/workflows/deploy.yml`, ou na VPS: `/opt/rampa/deploy.sh <sha>`).
#
# Saída: 0 no sucesso, 1 na falha (com ou sem rollback), 64 no uso errado, 75 com outro deploy
# segurando a trava além do prazo. Log em `/opt/rampa/deploy.log`.
#
# Configuração no `/opt/rampa/.env` (fora do Git, 600): as variáveis do Compose de produção,
# `RAMPA_HEALTHCHECK_AUTH` (`usuario:senha` do basic auth em texto puro, só lida por este
# script e nunca repassada a container) e, opcional, `RAMPA_REGISTRY` (padrão abaixo). As
# imagens são públicas no GHCR: a VPS não faz `docker login`. As variáveis `RAMPA_DIR`, `RAMPA_LOCK_WAIT_S`,
# `RAMPA_MIN_FREE_MB`, `RAMPA_HEALTH_WAIT_S` e `RAMPA_FIRST_HEALTH_WAIT_S` só existem para o
# teste (`infra/test/check-deploy.sh`); o SSH do `deploy` não repassa variáveis de ambiente.
set -euo pipefail

# A conexão SSH do Actions pode cair no meio (job cancelado, rede instável): o deploy segue até
# o fim, sem morrer ao escrever na saída fechada. O `tee` do log herda os sinais ignorados e
# continua gravando o arquivo.
trap '' HUP PIPE

readonly BOOTSTRAP_VERSION=1
readonly DEFAULT_REGISTRY=ghcr.io/brunotan14
readonly COMPOSE_IN_IMAGE=/app/deploy/docker-compose.prod.yml
readonly KEEP_RELEASES=3

RAMPA_DIR=${RAMPA_DIR:-/opt/rampa}
ENV_FILE=$RAMPA_DIR/.env
RELEASES=$RAMPA_DIR/releases
LOG_FILE=$RAMPA_DIR/deploy.log
LOCK_WAIT_S=${RAMPA_LOCK_WAIT_S:-900}
MIN_FREE_MB=${RAMPA_MIN_FREE_MB:-3072}
HEALTH_WAIT_S=${RAMPA_HEALTH_WAIT_S:-90}
FIRST_HEALTH_WAIT_S=${RAMPA_FIRST_HEALTH_WAIT_S:-300}

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERRO: $*"
  exit 1
}

valid_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

# Valor de `KEY` no .env, sem interpretar nada (o hash do basic auth tem `$`): a última linha
# `KEY=...`, sem as aspas em volta.
env_get() {
  local line value
  line=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1) || return 0
  value=${line#*=}
  case $value in
    \'*\' | \"*\") value=${value:1:${#value}-2} ;;
  esac
  printf '%s' "$value"
}

# Escrita atômica de `current` e `previous`.
write_state() {
  printf '%s\n' "$2" >"$RAMPA_DIR/$1.tmp"
  mv -f "$RAMPA_DIR/$1.tmp" "$RAMPA_DIR/$1"
}

read_state() {
  local value
  value=$(cat "$RAMPA_DIR/$1" 2>/dev/null || true)
  if valid_sha "$value"; then printf '%s' "$value"; fi
}

compose() {
  local tag=$1
  shift
  RAMPA_TAG=$tag docker compose -p rampa --env-file "$ENV_FILE" \
    -f "$RELEASES/$tag/docker-compose.prod.yml" "$@"
}

check_disk() {
  local root free
  root=$(docker info --format '{{.DockerRootDir}}')
  free=$(df -Pm "$root" | awk 'NR == 2 { print $4 }')
  if [ "${free:-0}" -lt "$MIN_FREE_MB" ]; then
    log "ERRO: só ${free:-0} MB livres em $root (mínimo: $MIN_FREE_MB MB)"
    return 1
  fi
  log "Disco: $free MB livres em $root"
}

# `docker pull` sem credencial. Recusa por autorização quase sempre é pacote privado no GHCR.
pull() {
  local out
  if out=$(docker pull --quiet "$1" 2>&1); then
    return 0
  fi
  printf '%s\n' "$out"
  if grep -qiE 'unauthorized|denied|authentication required' <<<"$out"; then
    log "ERRO: o registro recusou $1 sem credencial. Os pacotes rampa-app e rampa-scanner do GHCR precisam ser públicos (GitHub → Packages → <pacote> → Package settings → Change visibility → Public); a VPS não faz docker login"
  else
    log "ERRO: não consegui baixar $1"
  fi
  return 1
}

# Baixa as imagens e extrai o Compose da imagem do app para a pasta da release.
prepare() {
  local dir=$RELEASES/$SHA cid
  log "Baixando $APP_IMAGE e $SCANNER_IMAGE"
  pull "$APP_IMAGE" || return 1
  pull "$SCANNER_IMAGE" || return 1

  mkdir -p "$dir"
  touch "$dir"
  cid=$(docker create "$APP_IMAGE") || return 1
  if ! docker cp "$cid:$COMPOSE_IN_IMAGE" "$dir/docker-compose.prod.yml.tmp"; then
    docker rm "$cid" >/dev/null || true
    return 1
  fi
  docker rm "$cid" >/dev/null || true
  mv -f "$dir/docker-compose.prod.yml.tmp" "$dir/docker-compose.prod.yml"

  if ! grep -qx "x-bootstrap-version: $BOOTSTRAP_VERSION" "$dir/docker-compose.prod.yml"; then
    log "ERRO: o Compose da imagem não é da versão $BOOTSTRAP_VERSION do deploy.sh; reinstale o infra/deploy.sh desta versão"
    return 1
  fi
}

# Código HTTP de `https://$PHX_HOST/api/health` pelo Traefik (000 se não conectar). Com `$1`
# (`usuario:senha`), manda a credencial pela configuração na entrada padrão do curl, nunca na
# linha de comando (que outros usuários veem no `ps`).
health_code() {
  local auth=${1:-} code
  local args=(-sS -o /dev/null -w '%{http_code}' --max-time 10
    --resolve "$PHX_HOST:443:127.0.0.1" "https://$PHX_HOST/api/health")
  if [ -n "$auth" ]; then
    auth=${auth//\\/\\\\}
    auth=${auth//\"/\\\"}
    code=$(printf 'user = "%s"\n' "$auth" | curl -K - "${args[@]}" 2>/dev/null) || code=000
  else
    code=$(curl "${args[@]}" 2>/dev/null) || code=000
  fi
  printf '%s' "$code"
}

# Pelo host público, com certificado válido: sem credencial o basic auth responde 401; com a
# credencial o app novo responde 200 (healthcheck completo). No primeiro deploy a espera é maior
# (emissão do certificado).
check_traefik() {
  local wait=$1 deadline anonymous authenticated
  deadline=$((SECONDS + wait))
  while :; do
    anonymous=$(health_code)
    authenticated=$(health_code "$HEALTHCHECK_AUTH")
    if [ "$anonymous" = 401 ] && [ "$authenticated" = 200 ]; then
      log "Traefik: https://$PHX_HOST/api/health respondeu 401 sem credencial e 200 com ela"
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      log "ERRO: pelo Traefik, https://$PHX_HOST/api/health respondeu $anonymous sem credencial (esperado: 401) e $authenticated com ela (esperado: 200)"
      return 1
    fi
    sleep 5
  done
}

# Troca para a versão nova. Cada passo com `|| return 1`: dentro de `switch || rollback` o
# `set -e` não vale.
switch() {
  local wait=$HEALTH_WAIT_S
  [ -n "$CURRENT" ] || wait=$FIRST_HEALTH_WAIT_S

  log "Banco"
  compose "$SHA" up -d --wait --wait-timeout 120 postgres || return 1
  log "Migrations (bin/migrate)"
  # `traefik.enable=false`: o container das migrations nunca entra no roteador.
  compose "$SHA" run --rm --no-deps -l traefik.enable=false app /app/bin/migrate || return 1
  log "Scanner"
  compose "$SHA" up -d --wait --wait-timeout 180 scanner || return 1
  log "App"
  compose "$SHA" up -d --wait --wait-timeout 180 app || return 1
  check_traefik "$wait" || return 1
}

rollback() {
  if [ -z "$CURRENT" ] || [ "$CURRENT" = "$SHA" ]; then
    log "Sem versão anterior para voltar (primeiro deploy ou a mesma versão)."
    return 1
  fi
  if [ ! -f "$RELEASES/$CURRENT/docker-compose.prod.yml" ]; then
    log "ERRO: sem o Compose de $CURRENT em $RELEASES; volte à mão."
    return 1
  fi
  log "Rollback: voltando para $CURRENT, com o Compose e a etiqueta dela"
  compose "$CURRENT" up -d --wait --wait-timeout 300 --remove-orphans || return 1
  log "Rollback concluído: no ar $CURRENT"
}

# Mantém as $KEEP_RELEASES releases mais novas (sempre a atual e a anterior) e apaga as imagens
# das outras.
cleanup() {
  local previous=$1 kept=0 tag
  while IFS= read -r tag; do
    valid_sha "$tag" || continue
    if [ "$tag" = "$SHA" ] || [ "$tag" = "$previous" ] || [ "$kept" -lt "$KEEP_RELEASES" ]; then
      kept=$((kept + 1))
      continue
    fi
    log "Apagando a release antiga $tag"
    rm -rf "${RELEASES:?}/$tag"
    docker image rm "$REGISTRY/rampa-app:$tag" "$REGISTRY/rampa-scanner:$tag" >/dev/null 2>&1 || true
  done < <(ls -1t "$RELEASES")
  docker image prune -f >/dev/null 2>&1 || true
}

main() {
  if [ "$#" -ne 1 ] || ! valid_sha "$1"; then
    echo "uso: $0 <sha do commit, 40 caracteres hexadecimais minúsculos>" >&2
    exit 64
  fi
  SHA=$1

  [ -d "$RAMPA_DIR" ] || {
    echo "ERRO: $RAMPA_DIR não existe" >&2
    exit 1
  }
  if [ -f "$LOG_FILE" ] && [ "$(wc -c <"$LOG_FILE")" -gt 5242880 ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1"
  fi
  exec > >(tee -a "$LOG_FILE") 2>&1

  exec 9>"$RAMPA_DIR/.deploy.lock"
  if ! flock -w "$LOCK_WAIT_S" 9; then
    log "ERRO: outro deploy segura a trava há mais de ${LOCK_WAIT_S}s; nada foi feito"
    exit 75
  fi

  log "Deploy de $SHA"
  [ -f "$ENV_FILE" ] || fail "$ENV_FILE não existe (veja o cabeçalho de infra/docker-compose.prod.yml)"
  case $(stat -c '%a' "$ENV_FILE") in
    600 | 400) ;;
    *) fail "$ENV_FILE tem segredos e precisa de permissão 600" ;;
  esac
  PHX_HOST=$(env_get PHX_HOST)
  [ -n "$PHX_HOST" ] || fail "PHX_HOST não está no $ENV_FILE"
  HEALTHCHECK_AUTH=$(env_get RAMPA_HEALTHCHECK_AUTH)
  case $HEALTHCHECK_AUTH in
    ?*:?*) ;;
    *) fail "RAMPA_HEALTHCHECK_AUTH (usuario:senha do basic auth, em texto puro) não está no $ENV_FILE: sem ela o deploy não confere o app pelo Traefik" ;;
  esac
  REGISTRY=$(env_get RAMPA_REGISTRY)
  REGISTRY=${REGISTRY:-$DEFAULT_REGISTRY}
  export RAMPA_REGISTRY=$REGISTRY
  APP_IMAGE=$REGISTRY/rampa-app:$SHA
  SCANNER_IMAGE=$REGISTRY/rampa-scanner:$SHA
  CURRENT=$(read_state current)
  PREVIOUS=$(read_state previous)
  log "No ar: ${CURRENT:-nenhuma versão}"

  mkdir -p "$RELEASES"
  # Antes da troca: se falhar, nada mudou no ar.
  check_disk || fail "deploy de $SHA abortado antes da troca"
  prepare || fail "deploy de $SHA abortado antes da troca"

  if ! switch; then
    if rollback; then
      fail "deploy de $SHA falhou; de volta em $CURRENT"
    fi
    fail "deploy de $SHA falhou, sem rollback; confira os containers (docker compose -p rampa ps)"
  fi

  if [ -n "$CURRENT" ] && [ "$CURRENT" != "$SHA" ]; then
    PREVIOUS=$CURRENT
    write_state previous "$PREVIOUS"
  fi
  write_state current "$SHA"
  cleanup "$PREVIOUS"
  log "Deploy concluído: no ar $SHA"
}

main "$@"
