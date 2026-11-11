defmodule Rampa.Security.RuntimeEnv do
  @moduledoc """
  Ambiente usado nas checagens de subida (`Rampa.Application.start/2`): a `SSRF_ALLOWLIST`
  (`Rampa.Security.Allowlist`), o tamanho mínimo do `IP_HASH_SECRET`
  (`Rampa.Security.IPHash`) e o aviso de `TRUSTED_PROXIES` vazia.

  A release `:e2e` (config/e2e.exs) existe só para o Compose de teste e aceita a allowlist.
  Para uma imagem dessas, levada por engano a outro lugar, não desligar a proteção contra
  SSRF, o `:e2e` só vale com o marcador `RAMPA_E2E=1` em tempo de execução, que só o Compose
  de teste define. Sem ele, a release `:e2e` segue as regras de produção. Os outros
  ambientes não mudam.
  """

  @marker "1"

  @doc "Nome da variável do marcador."
  @spec marker_variable() :: String.t()
  def marker_variable, do: "RAMPA_E2E"

  @doc """
  Ambiente das checagens de subida, a partir do ambiente da compilação e do valor de
  `RAMPA_E2E`. `:e2e` sem o marcador (ou com outro valor) vira `:prod`.
  """
  @spec effective(atom(), String.t() | nil) :: atom()
  def effective(:e2e, @marker), do: :e2e
  def effective(:e2e, _marker), do: :prod
  def effective(env, _marker), do: env
end
