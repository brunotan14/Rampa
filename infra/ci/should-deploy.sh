#!/usr/bin/env bash
# Decide se o deploy de um sha da `main` segue (`.github/workflows/deploy.yml`). Imprime:
#
#   deploy             o staging não tem este sha nem um descendente dele: segue;
#   skip <sha no ar>   o último deploy com sucesso do environment `staging` já é este sha ou um
#                      descendente dele (um commit mais novo já foi para o ar): pula.
#
# Só pular quando o staging JÁ está à frente: com dois merges seguidos e o mais novo vermelho
# no CI, o mais antigo (verde) precisa ir para o ar. Sem deploy anterior, segue.
#
# Lê os deployments do environment pela API do GitHub (`gh`, com GH_TOKEN e
# `deployments: read`) e compara pela história do Git (`git merge-base --is-ancestor`), então
# precisa de um checkout com a história da `main` (`fetch-depth: 0`). Um sha no ar que o Git
# não conhece (história reescrita) não pula: avisa e segue.
#
#   GITHUB_REPOSITORY=dono/repo infra/ci/should-deploy.sh <sha>
#
# Teste: `infra/test/check-should-deploy.sh` (`gh` falso e um repositório Git de mentira).
set -euo pipefail

sha=${1:?uso: should-deploy.sh <sha>}
repo=${GITHUB_REPOSITORY:?defina GITHUB_REPOSITORY}
environment=${DEPLOY_ENVIRONMENT:-staging}

# Mais novos primeiro (ordem da API). O primeiro cujo status mais recente é `success` é o que
# está no ar; o deployment deste próprio job, se houver, ainda está `in_progress`.
deployments=$(gh api "repos/$repo/deployments?environment=$environment&per_page=50" \
  --jq '.[] | "\(.id) \(.sha)"')

deployed=""
while read -r id candidate; do
  [ -n "$id" ] || continue
  state=$(gh api "repos/$repo/deployments/$id/statuses?per_page=1" --jq '.[0].state // ""')
  if [ "$state" = success ]; then
    deployed=$candidate
    break
  fi
done <<<"$deployments"

if [ -z "$deployed" ]; then
  echo "deploy"
  exit 0
fi

status=0
git merge-base --is-ancestor "$sha" "$deployed" 2>/dev/null || status=$?
case $status in
  0) echo "skip $deployed" ;;
  1) echo "deploy" ;;
  *)
    echo "aviso: o Git não conhece $deployed (no ar no $environment); segue com o deploy" >&2
    echo "deploy"
    ;;
esac
