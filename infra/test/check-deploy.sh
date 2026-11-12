#!/usr/bin/env bash
# Teste do `infra/deploy.sh` (PRD §7, Hospedagem e deploy) com `docker` e `curl` falsos no
# PATH: nada sobe de verdade e nada sai da máquina. Roda num container Ubuntu 24.04 (o mesmo
# sistema da VPS: bash, flock, coreutils do GNU), sem rede e sem volume do host: os arquivos
# entram por `tar` na entrada padrão. Igual local e no CI.
#
#   infra/test/check-deploy.sh             sobe o container e roda os casos dentro dele
#   infra/test/check-deploy.sh --inside    roda os casos (só dentro do container)
#
# Casos: sucesso no primeiro e no segundo deploy; app sem healthcheck e Traefik sem o 401 →
# rollback com o Compose e a etiqueta anteriores; primeiro deploy que falha (sem rollback);
# migration que falha (o app novo não sobe); trava ocupada; sha inválido; Compose de outra
# versão do bootstrap; disco cheio; .env aberto demais; limpeza das releases antigas.
set -euo pipefail

UBUNTU_IMAGE=ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5

if [ "${1:-}" != "--inside" ]; then
  cd "$(dirname "$0")/../.."
  COPYFILE_DISABLE=1 tar --no-xattrs -cf - infra/deploy.sh infra/test/check-deploy.sh infra/docker-compose.prod.yml |
    docker run --rm -i --network none "$UBUNTU_IMAGE" \
      bash -c 'mkdir -p /w && tar -C /w -xf - && exec /w/infra/test/check-deploy.sh --inside'
  exit
fi

cd "$(dirname "$0")/../.."
REPO=$PWD
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

SHA1=1111111111111111111111111111111111111111
SHA2=2222222222222222222222222222222222222222
SHA3=3333333333333333333333333333333333333333
SHA4=4444444444444444444444444444444444444444
SHA5=5555555555555555555555555555555555555555

# docker falso: registra cada chamada (com a RAMPA_TAG) em $FAKE_LOG e falha os passos de
# $FAKE_FAIL, no formato `<passo>:<tag>` (`pull`, `migrate`, `up-postgres`, `up-scanner`,
# `up-app`, `up-all`). `docker cp` entrega $FAKE_COMPOSE como o Compose da imagem.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'FAKE'
#!/usr/bin/env bash
echo "RAMPA_TAG=${RAMPA_TAG:-} $*" >>"$FAKE_LOG"
failing() { [[ " ${FAKE_FAIL:-} " == *" $1:${RAMPA_TAG:-$2} "* ]]; }
case $1 in
  info) echo "$FAKE_DOCKER_ROOT" ;;
  pull) tag=${2##*:}; [ "$2" = --quiet ] && tag=${3##*:}; failing pull "$tag" && exit 1; exit 0 ;;
  create) echo cid-falso ;;
  cp) cp "$FAKE_COMPOSE" "$3" ;;
  compose)
    args=" $* "
    if [[ "$args" == *" run "* ]]; then step=migrate
    elif [[ "$args" == *" up "* ]]; then
      last=${*: -1}
      case $last in postgres | scanner | app) step=up-$last ;; *) step=up-all ;; esac
    else step=other; fi
    failing "$step" && exit 1
    exit 0
    ;;
esac
exit 0
FAKE
cat >"$WORK/bin/curl" <<'FAKE'
#!/usr/bin/env bash
echo "curl $*" >>"$FAKE_LOG"
printf '%s' "${FAKE_CURL_CODE:-401}"
FAKE
chmod +x "$WORK/bin/docker" "$WORK/bin/curl"

export PATH="$WORK/bin:$PATH"
export FAKE_DOCKER_ROOT=$WORK
export RAMPA_LOCK_WAIT_S=2 RAMPA_MIN_FREE_MB=1 RAMPA_HEALTH_WAIT_S=0 RAMPA_FIRST_HEALTH_WAIT_S=0

passed=0
failures=0

# Nova pasta /opt/rampa de mentira, com o .env (600) e o Compose do repositório.
fresh() {
  DIR=$WORK/case-$((passed + failures))
  mkdir -p "$DIR"
  printf '%s\n' "PHX_HOST=rampa.exemplo.test" "RAMPA_REGISTRY=registro.test/rampa" \
    "RAMPA_BASIC_AUTH='teste:\$2y\$05\$abc'" >"$DIR/.env"
  chmod 600 "$DIR/.env"
  export RAMPA_DIR=$DIR FAKE_LOG=$DIR/docker.log FAKE_COMPOSE=$REPO/infra/docker-compose.prod.yml
  export FAKE_FAIL="" FAKE_CURL_CODE=401
  : >"$FAKE_LOG"
}

# `deploy <sha>`: roda o deploy.sh e guarda o código de saída em $STATUS.
deploy() {
  STATUS=0
  "$REPO/infra/deploy.sh" "$@" >"$DIR/out.txt" 2>&1 || STATUS=$?
}

check() {
  local label=$1
  shift
  if "$@"; then
    passed=$((passed + 1))
  else
    failures=$((failures + 1))
    echo "FALHOU: $label" >&2
    sed 's/^/    saída: /' "$DIR/out.txt" >&2 || true
    sed 's/^/    docker: /' "$FAKE_LOG" >&2 || true
  fi
}

state() { cat "$DIR/$1" 2>/dev/null || true; }
called() { grep -qF -- "$1" "$FAKE_LOG"; }
said() { grep -qF -- "$1" "$DIR/out.txt"; }
status_is() { [ "$STATUS" -eq "$1" ]; }

echo "deploy.sh: primeiro deploy"
fresh
deploy "$SHA1"
check "primeiro deploy sai com 0" status_is 0
check "primeiro deploy grava current" [ "$(state current)" = "$SHA1" ]
check "primeiro deploy não grava previous" [ -z "$(state previous)" ]
check "baixa as duas imagens do registro do .env" called "pull --quiet registro.test/rampa/rampa-scanner:$SHA1"
check "extrai o Compose da imagem do app" [ -f "$DIR/releases/$SHA1/docker-compose.prod.yml" ]
check "sempre com -p rampa, o .env e o Compose da release" \
  called "RAMPA_TAG=$SHA1 compose -p rampa --env-file $DIR/.env -f $DIR/releases/$SHA1/docker-compose.prod.yml up -d --wait --wait-timeout 120 postgres"
check "migrations sem o Traefik e sem subir dependências" \
  called "run --rm --no-deps -l traefik.enable=false app /app/bin/migrate"
check "ordem: postgres, migrate, scanner, app, Traefik" \
  [ "$(grep -oE 'up -d --wait --wait-timeout [0-9]+ (postgres|scanner|app)$|/app/bin/migrate|^curl' "$FAKE_LOG" |
    sed -E 's/.* //' | tr '\n' ' ')" = "postgres /app/bin/migrate scanner app curl " ]
check "confere o 401 pelo Traefik, no host do .env" called "--resolve rampa.exemplo.test:443:127.0.0.1 https://rampa.exemplo.test/api/health"
check "registra no deploy.log" grep -qF "Deploy concluído: no ar $SHA1" "$DIR/deploy.log"

echo "deploy.sh: segundo deploy e rollbacks"
deploy "$SHA2"
check "segundo deploy sai com 0" status_is 0
check "segundo deploy: current e previous" [ "$(state current) $(state previous)" = "$SHA2 $SHA1" ]

: >"$FAKE_LOG"
FAKE_FAIL="up-app:$SHA3" deploy "$SHA3"
check "app sem healthcheck: sai com 1" status_is 1
check "app sem healthcheck: volta com o Compose e a etiqueta anteriores" \
  called "RAMPA_TAG=$SHA2 compose -p rampa --env-file $DIR/.env -f $DIR/releases/$SHA2/docker-compose.prod.yml up -d --wait --wait-timeout 300 --remove-orphans"
check "app sem healthcheck: current e previous não mudam" [ "$(state current) $(state previous)" = "$SHA2 $SHA1" ]
check "app sem healthcheck: avisa do rollback" said "de volta em $SHA2"

: >"$FAKE_LOG"
FAKE_CURL_CODE=000 deploy "$SHA3"
check "Traefik sem o 401: sai com 1" status_is 1
check "Traefik sem o 401: volta para a anterior" called "RAMPA_TAG=$SHA2 compose -p rampa"
check "Traefik sem o 401: current não muda" [ "$(state current)" = "$SHA2" ]

: >"$FAKE_LOG"
FAKE_FAIL="migrate:$SHA3" deploy "$SHA3"
check "migration falha: sai com 1" status_is 1
check "migration falha: o app novo não sobe" bash -c "! grep -qE 'RAMPA_TAG=$SHA3 .*up .*(scanner|app)$' '$FAKE_LOG'"
check "migration falha: current não muda" [ "$(state current)" = "$SHA2" ]

: >"$FAKE_LOG"
FAKE_FAIL="up-app:$SHA3 up-all:$SHA2" deploy "$SHA3"
check "rollback que também falha: sai com 1 e avisa" bash -c "[ $STATUS -eq 1 ] && grep -qF 'sem rollback' '$DIR/out.txt'"

echo "deploy.sh: primeiro deploy que falha"
fresh
FAKE_FAIL="up-app:$SHA1" deploy "$SHA1"
check "primeiro deploy com falha: sai com 1" status_is 1
check "primeiro deploy com falha: sem rollback" bash -c "! grep -qF -- '--remove-orphans' '$FAKE_LOG'"
check "primeiro deploy com falha: sem current" [ -z "$(state current)" ]
check "primeiro deploy com falha: explica" said "Sem versão anterior"

echo "deploy.sh: antes da troca"
fresh
FAKE_FAIL="pull:$SHA1" deploy "$SHA1"
check "pull falha: sai com 1 sem tocar no Compose" bash -c "[ $STATUS -eq 1 ] && ! grep -qF ' compose ' '$FAKE_LOG'"

fresh
RAMPA_MIN_FREE_MB=999999999 deploy "$SHA1"
check "disco cheio: sai com 1 sem baixar nada" bash -c "[ $STATUS -eq 1 ] && ! grep -qF ' pull ' '$FAKE_LOG'"

fresh
sed 's/^x-bootstrap-version: 1$/x-bootstrap-version: 2/' "$REPO/infra/docker-compose.prod.yml" >"$DIR/outro.yml"
FAKE_COMPOSE=$DIR/outro.yml deploy "$SHA1"
check "Compose de outra versão do bootstrap: recusa" bash -c "[ $STATUS -eq 1 ] && ! grep -qF ' compose ' '$FAKE_LOG'"
check "Compose de outra versão do bootstrap: explica" said "reinstale o infra/deploy.sh"

fresh
chmod 644 "$DIR/.env"
deploy "$SHA1"
check ".env legível por outros: recusa" bash -c "[ $STATUS -eq 1 ] && ! grep -qF ' pull ' '$FAKE_LOG'"

fresh
grep -v '^PHX_HOST=' "$DIR/.env" >"$DIR/env.tmp" && mv "$DIR/env.tmp" "$DIR/.env" && chmod 600 "$DIR/.env"
deploy "$SHA1"
check "sem PHX_HOST: recusa" bash -c "[ $STATUS -eq 1 ] && ! grep -qF ' pull ' '$FAKE_LOG'"

echo "deploy.sh: uso e trava"
fresh
for bad in "" "abc" "ABCDEF0123456789ABCDEF0123456789ABCDEF01" "$SHA1 $SHA2" "${SHA1}0" "$SHA1;id"; do
  # shellcheck disable=SC2086 # de propósito: "$SHA1 $SHA2" vira dois argumentos.
  deploy $bad
  check "sha inválido ($bad): sai com 64" status_is 64
done
check "sha inválido: nenhuma chamada ao docker" [ ! -s "$FAKE_LOG" ]

fresh
mkdir -p "$DIR"
flock "$DIR/.deploy.lock" sleep 6 &
holder=$!
sleep 1
deploy "$SHA1"
check "trava ocupada: sai com 75" status_is 75
check "trava ocupada: nada foi feito" bash -c "! grep -qF ' pull ' '$FAKE_LOG'"
wait "$holder"

echo "deploy.sh: limpeza das releases"
fresh
for sha in "$SHA1" "$SHA2" "$SHA3" "$SHA4" "$SHA5"; do
  deploy "$sha"
  sleep 1 # ordem por data de modificação
done
check "mantém as 3 releases mais novas" \
  [ "$(find "$DIR/releases" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort | tr '\n' ' ')" = "$SHA3 $SHA4 $SHA5 " ]
check "apaga as imagens das antigas" called "image rm registro.test/rampa/rampa-app:$SHA1 registro.test/rampa/rampa-scanner:$SHA1"
check "nunca apaga a atual nem a anterior" bash -c "! grep -qE 'image rm .*($SHA4|$SHA5)' '$FAKE_LOG'"

echo "deploy.sh: $passed ok, $failures falha(s)"
[ "$failures" -eq 0 ]
