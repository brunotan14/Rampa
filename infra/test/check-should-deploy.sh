#!/usr/bin/env bash
# Teste do `infra/ci/should-deploy.sh` com `gh` falso no PATH e um repositório Git de mentira
# (A ← B ← C na `main`, e D num ramo a partir de A). Nada sai da máquina.
#
# Casos: sem deploy anterior; no ar um descendente (pula); no ar um ancestral (segue: o caso
# do commit mais novo vermelho no CI); no ar o próprio sha (pula); o mais recente com sucesso
# vale, não o mais recente (falhou ou em curso); depois de um rollback; sha no ar desconhecido
# (segue com aviso); erro da API (falha, sem decidir).
set -euo pipefail

cd "$(dirname "$0")/../.."
SCRIPT=$PWD/infra/ci/should-deploy.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git init -q -b main "$WORK/repo"
commit() {
  git -C "$WORK/repo" -c user.name=teste -c user.email=teste@exemplo.test \
    commit -q --allow-empty -m "$1"
  git -C "$WORK/repo" rev-parse HEAD
}
A=$(commit A)
B=$(commit B)
C=$(commit C)
git -C "$WORK/repo" checkout -q -b ramo "$A"
D=$(commit D)
UNKNOWN=ffffffffffffffffffffffffffffffffffffffff

# gh falso: `deployments?...` lista $FAKE_DEPLOYMENTS (`id sha` por linha, mais novo primeiro);
# `deployments/<id>/statuses` devolve o estado de `<id>` em $FAKE_STATES (`id estado`).
mkdir -p "$WORK/bin"
cat >"$WORK/bin/gh" <<'FAKE'
#!/usr/bin/env bash
[ "${FAKE_GH_FAIL:-}" = 1 ] && { echo "HTTP 502" >&2; exit 1; }
case $2 in
  */statuses*) id=${2#*/deployments/}; id=${id%%/*}; awk -v id="$id" '$1 == id { print $2 }' <<<"$FAKE_STATES" ;;
  *deployments\?environment=staging*) printf '%s\n' "$FAKE_DEPLOYMENTS" ;;
  *) echo "chamada inesperada: $*" >&2; exit 1 ;;
esac
FAKE
chmod +x "$WORK/bin/gh"
export PATH="$WORK/bin:$PATH" GITHUB_REPOSITORY=dono/rampa

passed=0
failures=0

# `expect <descrição> <saída esperada> <sha> <deployments> <estados>`
expect() {
  local label=$1 want=$2 got
  got=$(cd "$WORK/repo" && FAKE_DEPLOYMENTS=$4 FAKE_STATES=$5 "$SCRIPT" "$3" 2>"$WORK/err") || got="erro"
  if [ "$got" = "$want" ]; then
    passed=$((passed + 1))
  else
    failures=$((failures + 1))
    echo "FALHOU: $label (esperado \"$want\", veio \"$got\")" >&2
    sed 's/^/    stderr: /' "$WORK/err" >&2
  fi
}

expect "sem deploy anterior: segue" deploy "$B" "" ""
expect "no ar um descendente: pula" "skip $C" "$B" "1 $C" "1 success"
expect "no ar um ancestral (o mais novo ficou vermelho no CI): segue" deploy "$B" "1 $A" "1 success"
expect "no ar o próprio sha: pula" "skip $B" "$B" "1 $B" "1 success"
expect "no ar outro ramo: segue" deploy "$B" "1 $D" "1 success"
expect "o mais recente com sucesso vale, não o que falhou ou está em curso" "skip $C" "$B" \
  "$(printf '3 %s\n2 %s\n1 %s' "$B" "$A" "$C")" "$(printf '3 in_progress\n2 failure\n1 success')"
expect "depois de um rollback, vale o último sucesso (o mais antigo no ar): segue" deploy "$B" \
  "$(printf '2 %s\n1 %s' "$A" "$C")" "$(printf '2 success\n1 success')"
expect "nenhum com sucesso: segue" deploy "$B" "$(printf '2 %s\n1 %s' "$C" "$C")" "$(printf '2 failure\n1 error')"
expect "sha no ar desconhecido do Git: segue" deploy "$B" "1 $UNKNOWN" "1 success"
if grep -qF "não conhece" "$WORK/err"; then passed=$((passed + 1)); else
  failures=$((failures + 1))
  echo "FALHOU: sha desconhecido sem aviso" >&2
fi
FAKE_GH_FAIL=1 expect "erro da API: falha sem decidir" erro "$B" "" ""

echo "should-deploy.sh: $passed ok, $failures falha(s)"
[ "$failures" -eq 0 ]
