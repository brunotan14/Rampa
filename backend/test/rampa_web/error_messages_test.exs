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

  describe "RF-RA029: http_error pelo status" do
    test "404 e 410: página não encontrada, com o status" do
      for status <- [404, 410] do
        assert ErrorMessages.message(:http_error, http_status: status) ==
                 "A página não foi encontrada (HTTP #{status}). Confira o endereço."
      end
    end

    test "500, 502, 503 e 504: site instável, com o status" do
      for status <- [500, 502, 503, 504] do
        assert ErrorMessages.message(:http_error, http_status: status) ==
                 "O site respondeu com um erro (HTTP #{status}) e pode estar instável. " <>
                   "Tente de novo em alguns minutos."
      end
    end

    test "429: acesso de robôs limitado" do
      assert ErrorMessages.message(:http_error, http_status: 429) ==
               "O site limitou o acesso de robôs (HTTP 429). Tente mais tarde."
    end

    test "401: o aviso de barreira de login (RF-RA028)" do
      assert ErrorMessages.message(:http_error, http_status: 401) ==
               "Esta página pede login (HTTP 401). O Rampa audita só o que um visitante " <>
                 "anônimo vê; áreas logadas ainda não são cobertas."
    end

    # 403 num site público costuma ser bloqueio de robô: a mensagem não afirma que é login.
    test "403: acesso recusado, login ou bloqueio de acessos automáticos" do
      message = ErrorMessages.message(:http_error, http_status: 403)

      assert message ==
               "O site recusou o acesso (HTTP 403). Ele pode exigir login ou bloquear " <>
                 "acessos automáticos."

      refute message =~ "pede login"
    end

    test "outro status: a mensagem genérica com o status; sem status, sem número" do
      assert ErrorMessages.message(:http_error, http_status: 400) =~ "(HTTP 400)"

      assert ErrorMessages.message(:http_error) ==
               "A página respondeu com um erro HTTP e não foi analisada."
    end

    test "timeout e navigation_failed sugerem tentar de novo" do
      assert ErrorMessages.message(:timeout) =~ "Tente de novo"
      assert ErrorMessages.message(:navigation_failed) =~ "Tente de novo"
    end

    test "page_error leva o http_status só quando há status" do
      assert %{code: "http_error", http_status: 503, message: message} =
               ErrorMessages.page_error("http_error", 503)

      assert message =~ "(HTTP 503)"
      assert ErrorMessages.page_error("timeout", nil) == ErrorMessages.error("timeout")
    end
  end

  test "contract_mismatch não promete prazo curto" do
    message = ErrorMessages.message(:contract_mismatch)
    refute message =~ "minutos"
    assert message =~ "incompatibilidade interna"
  end
end
