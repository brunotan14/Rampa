#!/usr/bin/env bash
# RF-RA002 e PRD §7: "o container do scanner fica numa rede Docker sem acesso ao PostgreSQL".
# Roda `network-probe.mjs` DENTRO do container do scanner do Compose de teste (que precisa
# estar de pé): o nome `postgres` não resolve, nenhum IP do banco aceita conexão na 5432 e,
# como controle, o `fixtures:80` aceita.
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f infra/docker-compose.test.yml)

postgres_id=$("${COMPOSE[@]}" ps -q postgres)
if [ -z "$postgres_id" ]; then
  echo "FALHOU: o postgres do Compose de teste não está de pé" >&2
  exit 1
fi
postgres_ips=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$postgres_id")

"${COMPOSE[@]}" exec -T -e POSTGRES_IPS="$postgres_ips" scanner \
  node --input-type=module -e "$(cat infra/test/network-probe.mjs)"
