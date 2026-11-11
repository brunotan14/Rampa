#!/usr/bin/env bash
# Confere as versões locais contra as do CI, antes do `make ci`:
#   * Node: precisa ser a do `.nvmrc` (a mesma do CI e da imagem do scanner); diferente, falha;
#   * Erlang/OTP e Elixir: as do `env` de `.github/workflows/ci.yml`; diferente, só avisa
#     (o projeto aceita outras versões, mas os avisos de compilação podem mudar).
set -euo pipefail

cd "$(dirname "$0")/../.."

expected_node="v$(tr -d '[:space:]' < .nvmrc)"
actual_node="$(node --version 2>/dev/null || echo "ausente")"
if [ "$actual_node" != "$expected_node" ]; then
  echo "Node $actual_node, mas o .nvmrc pede $expected_node: rode \`nvm use\` e tente de novo." >&2
  exit 1
fi
echo "Node $actual_node (igual ao .nvmrc)"

ci_env() {
  sed -nE "s/^[[:space:]]+$1:[[:space:]]*\"?([^\"]+)\"?[[:space:]]*$/\1/p" .github/workflows/ci.yml | head -n 1
}

expected_otp="$(ci_env OTP_VERSION)"
expected_elixir="$(ci_env ELIXIR_VERSION)"
if [ -z "$expected_otp" ] || [ -z "$expected_elixir" ]; then
  echo "Não achei OTP_VERSION e ELIXIR_VERSION no env de .github/workflows/ci.yml: atualize este script." >&2
  exit 1
fi
actual_otp="$(erl -noshell -eval '
  Release = erlang:system_info(otp_release),
  File = filename:join([code:root_dir(), "releases", Release, "OTP_VERSION"]),
  Version = case file:read_file(File) of {ok, V} -> string:trim(V); _ -> Release end,
  io:format("~s", [Version]),
  halt().' 2>/dev/null || echo "ausente")"
actual_elixir="$(elixir --short-version 2>/dev/null || echo "ausente")"

# O CI fixa o OTP em major.minor (`29.1`): vale qualquer patch dessa linha.
case "$actual_otp" in
  "$expected_otp" | "$expected_otp".*) echo "Erlang/OTP $actual_otp (CI: $expected_otp)" ;;
  *) echo "Aviso: Erlang/OTP $actual_otp, o CI usa $expected_otp." >&2 ;;
esac

if [ "$actual_elixir" = "$expected_elixir" ]; then
  echo "Elixir $actual_elixir (CI: $expected_elixir)"
else
  echo "Aviso: Elixir $actual_elixir, o CI usa $expected_elixir." >&2
fi
