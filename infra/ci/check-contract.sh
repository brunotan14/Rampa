#!/usr/bin/env bash
# Confere que um contrato gerado está atualizado: regenera e falha se algum arquivo mudar.
# Fonte única desta checagem: os passos "Contrato OpenAPI atualizado", "Contrato do scanner
# atualizado" e "Tipos da API e do canal atualizados" do CI (`.github/workflows/ci.yml`) e o
# `make ci` chamam este script.
#
#   infra/ci/check-contract.sh openapi    shared/openapi.json (`make openapi`)
#   infra/ci/check-contract.sh scanner    scanner/src/contract.gen.ts (`make scanner-contract`)
#   infra/ci/check-contract.sh frontend   frontend/src/api/schema.gen.ts e channel.gen.ts
#                                         (`make api-types`)
#
# Compara com a cópia de trabalho de antes da regeneração, não com o último commit: no CI,
# que parte de um checkout limpo, dá o mesmo que `git diff --exit-code`; localmente, uma
# mudança no contrato ainda não commitada (e já regenerada) passa, com um aviso para versioná-la.
# Desatualizado, o arquivo fica regenerado: confira o diff e versione.
set -euo pipefail

cd "$(dirname "$0")/../.."

case "${1:-}" in
  openapi)
    tracked=(shared/openapi.json)
    generated=(shared/openapi.json)
    command="make openapi"
    ;;
  scanner)
    tracked=(shared/scanner-contract.schema.json scanner/src/contract.gen.ts)
    generated=(scanner/src/contract.gen.ts)
    command="make scanner-contract"
    ;;
  frontend)
    tracked=(shared/openapi.json shared/channel-events.schema.json
      frontend/src/api/schema.gen.ts frontend/src/api/channel.gen.ts)
    generated=(frontend/src/api/schema.gen.ts frontend/src/api/channel.gen.ts)
    command="make api-types"
    ;;
  *)
    echo "uso: $0 openapi|scanner|frontend" >&2
    exit 2
    ;;
esac

# Os arquivos precisam estar versionados: sem isso, o diff não teria com o que comparar.
git ls-files --error-unmatch "${tracked[@]}"

before=$(mktemp -d)
trap 'rm -rf "$before"' EXIT
for file in "${generated[@]}"; do
  mkdir -p "$before/$(dirname "$file")"
  cp "$file" "$before/$file"
done

case "$1" in
  openapi) make openapi ;;
  scanner) npm --prefix scanner run contract ;;
  frontend) npm --prefix frontend run api-types ;;
esac

stale=0
for file in "${generated[@]}"; do
  if ! git diff --no-index --exit-code -- "$before/$file" "$file"; then
    echo "$file estava desatualizado: rode \`$command\` e versione o arquivo." >&2
    stale=1
  fi
done
[ "$stale" -eq 0 ] || exit 1

# Atualizado, mas diferente do último commit: passa aqui, e o CI só vê o que for commitado.
for file in "${generated[@]}"; do
  if ! git diff --quiet HEAD -- "$file"; then
    echo "Aviso: $file tem mudança ainda não commitada; versione-a junto com o contrato." >&2
  fi
done
