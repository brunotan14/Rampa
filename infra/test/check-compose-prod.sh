#!/usr/bin/env bash
# Confere o Compose de produção (`infra/docker-compose.prod.yml`, PRD §7 e RNF-RA003) sem subir
# nada: renderiza com um .env fictício (`docker compose config --format json`) e prova as regras
# de que o deploy depende. Precisa só do Docker CLI com o Compose e do `jq`.
#
#   * projeto `rampa`, volumes e redes com nome fixo, `x-bootstrap-version` do `infra/deploy.sh`;
#   * nenhum serviço publica porta (só o Traefik alcança o app), nada de `env_file`;
#   * segredos só onde são usados: app (SECRET_KEY_BASE, IP_HASH_SECRET, DATABASE_URL) e
#     postgres (POSTGRES_PASSWORD); o scanner não recebe nenhum; SSRF_ALLOWLIST em nenhum;
#   * a credencial do healthcheck (`RAMPA_HEALTHCHECK_AUTH`, só do `infra/deploy.sh`) em nenhum
#     serviço;
#   * o scanner fora da rede do banco, que é interna; só o app tem labels do Traefik, com o
#     entrypoint, o resolver e o proxy confiável vindos do .env (sem padrão no arquivo);
#   * limites de memória (soma ≤ 2,5 GiB, sem swap além do limite), CPU do scanner,
#     `oom_score_adj` (banco por último), endurecimento (`cap_drop`, `read_only`,
#     `no-new-privileges`, `pids_limit`, `restart`) em todos;
#   * variável obrigatória faltando (PHX_HOST, segredos, Traefik, TRUSTED_PROXIES) impede o
#     `config`.
set -euo pipefail

cd "$(dirname "$0")/../.."

FILE=infra/docker-compose.prod.yml
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

SECRET_KEY_BASE=segredo-ficticio-secret-key-base-0123456789
IP_HASH_SECRET=segredo-ficticio-ip-hash-0123456789
POSTGRES_PASSWORD=senhaficticia0123456789
HEALTHCHECK_PASSWORD=senha-do-healthcheck-ficticia
cat >"$WORK/env" <<EOF
PHX_HOST=rampa.exemplo.test
SECRET_KEY_BASE=$SECRET_KEY_BASE
IP_HASH_SECRET=$IP_HASH_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
RAMPA_BASIC_AUTH='teste:\$2y\$05\$abcdefghijklmnopqrstuv'
RAMPA_HEALTHCHECK_AUTH=teste:$HEALTHCHECK_PASSWORD
TRAEFIK_ENTRYPOINT=entrada-ficticia
TRAEFIK_CERTRESOLVER=resolver-ficticio
TRUSTED_PROXIES=172.30.240.1/32
EOF

render() {
  RAMPA_TAG=0123456789abcdef0123456789abcdef01234567 RAMPA_REGISTRY=registro.test/rampa \
    docker compose -p rampa --env-file "$1" -f "$FILE" config --format json
}

render "$WORK/env" >"$WORK/config.json"

failures=0
# `expect <descrição> <filtro jq que precisa dar true>`
expect() {
  if [ "$(jq -r "$2" "$WORK/config.json")" = "true" ]; then
    echo "ok: $1"
  else
    echo "FALHOU: $1" >&2
    failures=$((failures + 1))
  fi
}

expect "projeto rampa" '.name == "rampa"'
expect "x-bootstrap-version do deploy.sh" \
  "(.\"x-bootstrap-version\" | tostring) == \"$(sed -nE 's/^readonly BOOTSTRAP_VERSION=([0-9]+)$/\1/p' infra/deploy.sh)\""
expect "volumes com nome fixo" '.volumes.pgdata.name == "rampa_pgdata" and .volumes.crops.name == "rampa_crops"'
expect "redes com nome fixo" '[.networks[] | .name | startswith("rampa_")] | all'
expect "os três serviços, e só eles" '(.services | keys) == ["app", "postgres", "scanner"]'
expect "nenhum serviço publica porta" '[.services[] | .ports == null] | all'
expect "nada de env_file" '[.services[] | .env_file == null] | all'
expect "SSRF_ALLOWLIST em nenhum serviço" '[.services[] | (.environment // {}) | has("SSRF_ALLOWLIST") | not] | all'

# Os valores fictícios dos segredos só aparecem no serviço que os usa.
expect "segredos do app só no app" \
  "[.services | to_entries[] | select(.key != \"app\") | .value | tostring | (contains(\"$SECRET_KEY_BASE\") or contains(\"$IP_HASH_SECRET\")) | not] | all"
expect "a senha do banco só no app (DATABASE_URL) e no postgres" \
  "(.services.scanner | tostring | contains(\"$POSTGRES_PASSWORD\") | not) and (.services.app.environment.DATABASE_URL | contains(\"$POSTGRES_PASSWORD\")) and .services.postgres.environment.POSTGRES_PASSWORD == \"$POSTGRES_PASSWORD\""
expect "o scanner não recebe segredo" \
  '(.services.scanner.environment | keys) - ["NODE_ENV", "HOST", "PORT"] == [] and .services.scanner.environment.NODE_ENV == "production"'

expect "a credencial do healthcheck em nenhum serviço" \
  "(.services | tostring | contains(\"$HEALTHCHECK_PASSWORD\")) | not"
if grep -qF RAMPA_HEALTHCHECK_AUTH "$FILE"; then
  echo "FALHOU: $FILE não pode usar a RAMPA_HEALTHCHECK_AUTH (é só do deploy.sh)" >&2
  failures=$((failures + 1))
else
  echo "ok: o Compose não lê a RAMPA_HEALTHCHECK_AUTH"
fi

# Nada da configuração da VPS no arquivo versionado (o repositório é público): entrypoint,
# resolver e proxy confiável sem valor padrão.
if grep -qE '\$\{(TRAEFIK_ENTRYPOINT|TRAEFIK_CERTRESOLVER|TRUSTED_PROXIES):-' "$FILE"; then
  echo "FALHOU: $FILE dá valor padrão a TRAEFIK_ENTRYPOINT, TRAEFIK_CERTRESOLVER ou TRUSTED_PROXIES" >&2
  failures=$((failures + 1))
else
  echo "ok: entrypoint, resolver e proxy confiável só do .env"
fi

expect "o scanner fora da rede do banco" '(.services.scanner.networks | has("db")) | not'
expect "o banco só na rede db, interna" '(.services.postgres.networks | keys) == ["db"] and .networks.db.internal == true'
expect "app e scanner por rede interna" '.networks.scan.internal == true and (.services.app.networks | has("scan")) and (.services.scanner.networks | has("scan"))'
expect "só o app com labels do Traefik" \
  '([.services | to_entries[] | select(.key != "app") | .value.labels // {} | keys[] | select(startswith("traefik."))] | length) == 0 and .services.app.labels["traefik.enable"] == "true"'
expect "o Traefik entra pela rede edge" '.services.app.labels["traefik.docker.network"] == .networks.edge.name and (.services.app.networks | has("edge"))'
expect "proxy confiável vem do .env" '.services.app.environment.TRUSTED_PROXIES == "172.30.240.1/32"'
# shellcheck disable=SC2016 # `$l` é variável do jq.
expect "entrypoint e resolver do Traefik vêm do .env, nos dois roteadores" \
  '.services.app.labels as $l | ([$l | to_entries[] | select(.key | endswith(".entrypoints")) | .value] == ["entrada-ficticia", "entrada-ficticia"]) and ([$l | to_entries[] | select(.key | endswith(".tls.certresolver")) | .value] == ["resolver-ficticio", "resolver-ficticio"])'
expect "basic auth nos dois roteadores" \
  '(.services.app.labels["traefik.http.routers.rampa.middlewares"] | split(",") | index("rampa-auth")) != null and (.services.app.labels["traefik.http.routers.rampa-socket.middlewares"] | split(",") | index("rampa-auth")) != null'
# shellcheck disable=SC2016 # as crases são do Traefik, não do shell.
expect "host do roteador vem do .env" '.services.app.labels["traefik.http.routers.rampa.rule"] == "Host(`rampa.exemplo.test`)"'

expect "todos com limite de memória, sem swap além dele" \
  '[.services[] | .mem_limit != null and .memswap_limit == .mem_limit] | all'
expect "soma dos limites de memória ≤ 2,5 GiB (RNF-RA003)" \
  '([.services[] | .mem_limit | tonumber] | add) <= (2.5 * 1024 * 1024 * 1024)'
expect "limites do RNF-RA003: scanner 1,5 GiB e 1,5 CPU, app e banco 512 MiB" \
  '(.services.scanner.mem_limit | tonumber) == 1610612736 and .services.scanner.cpus == 1.5 and (.services.app.mem_limit | tonumber) == 536870912 and (.services.postgres.mem_limit | tonumber) == 536870912'
expect "OOM: o scanner morre primeiro, o banco por último" \
  '.services.scanner.oom_score_adj > .services.app.oom_score_adj and .services.app.oom_score_adj > .services.postgres.oom_score_adj and .services.postgres.oom_score_adj < 0'
expect "endurecimento em todos" \
  '[.services[] | .read_only == true and .cap_drop == ["ALL"] and (.security_opt | index("no-new-privileges:true")) != null and .pids_limit != null and .restart == "unless-stopped"] | all'
expect "imagens por etiqueta do deploy; o banco por digest" \
  '(.services.app.image | endswith(":0123456789abcdef0123456789abcdef01234567")) and (.services.scanner.image | endswith(":0123456789abcdef0123456789abcdef01234567")) and (.services.postgres.image | test("@sha256:[0-9a-f]{64}$"))'
expect "stop_grace_period do app maior que o do Oban (30 s)" '.services.app.stop_grace_period == "45s"'
expect "healthcheck em todos" '[.services[] | .healthcheck.test != null] | all'

# Variável obrigatória faltando: o Compose recusa, e o deploy para antes de trocar nada.
for name in PHX_HOST SECRET_KEY_BASE IP_HASH_SECRET POSTGRES_PASSWORD RAMPA_BASIC_AUTH \
  TRAEFIK_ENTRYPOINT TRAEFIK_CERTRESOLVER TRUSTED_PROXIES; do
  grep -v "^$name=" "$WORK/env" >"$WORK/env-sem"
  if render "$WORK/env-sem" >/dev/null 2>&1; then
    echo "FALHOU: sem $name o Compose deveria recusar" >&2
    failures=$((failures + 1))
  else
    echo "ok: sem $name, o Compose recusa"
  fi
done

if [ "$failures" -ne 0 ]; then
  echo "Compose de produção: $failures falha(s)" >&2
  exit 1
fi
echo "Compose de produção: tudo certo"
