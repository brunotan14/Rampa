defmodule RampaWeb.ErrorMessagesTest do
  use ExUnit.Case, async: true

  alias RampaWeb.ErrorMessages

  test "RF-RA001: esquema não suportado explica que só endereços web são aceitos" do
    assert ErrorMessages.message(:unsupported_scheme) ==
             "Só endereços web (http:// ou https://) podem ser auditados."
  end

  test "RF-RA002: endereço bloqueado diz \"Este endereço não pode ser auditado\"" do
    assert ErrorMessages.message(:blocked_address) =~ "Este endereço não pode ser auditado"
  end

  test "RF-RA002: limite de taxa diz o horário em São Paulo, HH:MM" do
    # 17:32 UTC = 14:32 em São Paulo (UTC-3).
    retry_at = ~U[2026-11-10 17:32:00Z]

    assert ErrorMessages.message(:rate_limited, retry_at: retry_at) =~ "a partir das 14:32"
  end

  test "todo código listado tem mensagem própria, diferente da genérica" do
    generic = ErrorMessages.message(:internal_error)

    for code <-
          Enum.map(Rampa.ErrorCodes.all(), &Atom.to_string/1) --
            ["internal_error", "rate_limited"] do
      message = ErrorMessages.message(code)
      assert is_binary(message) and message != "", code
      assert message != generic, code
    end
  end

  test "código desconhecido ganha a mensagem genérica e mantém o código" do
    assert %{code: "algo_novo", message: message} = ErrorMessages.error("algo_novo")
    assert message == ErrorMessages.message(:internal_error)
  end

  test "nenhuma mensagem diz que o site está conforme ou é acessível" do
    for code <- Enum.map(Rampa.ErrorCodes.all(), &Atom.to_string/1) -- ["rate_limited"] do
      refute ErrorMessages.message(code) =~ ~r/est[aá] conforme|[eé] acess[ií]vel/i, code
    end
  end

  test "contract_mismatch não promete prazo curto" do
    message = ErrorMessages.message(:contract_mismatch)
    refute message =~ "minutos"
    assert message =~ "incompatibilidade interna"
  end
end
