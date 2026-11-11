#!/usr/bin/env bash
# Confere que um contrato gerado está atualizado: regenera e falha se o arquivo mudar.
# Fonte única desta checagem: os passos "Contrato OpenAPI atualizado" e "Contrato do scanner
# atualizado" do CI (`.github/workflows/ci.yml`) e o `make ci` chamam este script.
#
#   infra/ci/check-contract.sh openapi   shared/openapi.json (`make openapi`)
#   infra/ci/check-contract.sh scanner   scanner/src/contract.gen.ts (`make scanner-contract`)
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
    generated=shared/openapi.json
    command="make openapi"
    ;;
  scanner)
    tracked=(shared/scanner-contract.schema.json scanner/src/contract.gen.ts)
    generated=scanner/src/contract.gen.ts
    command="make scanner-contract"
    ;;
  *)
    echo "uso: $0 openapi|scanner" >&2
    exit 2
    ;;
esac

# Os arquivos precisam estar versionados: sem isso, o diff não teria com o que comparar.
git ls-files --error-unmatch "${tracked[@]}"

before=$(mktemp)
trap 'rm -f "$before"' EXIT
cp "$generated" "$before"

case "$1" in
  openapi) make openapi ;;
  scanner) npm --prefix scanner run contract ;;
esac

if ! git diff --no-index --exit-code -- "$before" "$generated"; then
  echo "$generated estava desatualizado: rode \`$command\` e versione o arquivo." >&2
  exit 1
fi

# Atualizado, mas diferente do último commit: passa aqui, e o CI só vê o que for commitado.
if ! git diff --quiet HEAD -- "$generated"; then
  echo "Aviso: $generated tem mudança ainda não commitada; versione-a junto com o contrato." >&2
fi
