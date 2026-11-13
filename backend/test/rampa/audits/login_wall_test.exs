defmodule Rampa.Audits.LoginWallTest do
  @moduledoc """
  RF-RA028: a decisão de barreira de login a partir dos fatos do scanner. Precisão antes de
  cobertura: redirecionamento sozinho e senha sem redirecionamento não são barreira.
  """

  use ExUnit.Case, async: true

  alias Rampa.Audits.LoginWall

  @requested "https://exemplo.com/painel"

  defp decide(final_url, password_field, http_status \\ 200) do
    LoginWall.decide(%{
      requested_url: @requested,
      final_url: final_url,
      http_status: http_status,
      password_field: password_field
    })
  end

  describe "status 401 e 403" do
    test "401 é barreira, com ou sem os outros fatos" do
      assert LoginWall.decide(%{http_status: 401})
      assert decide(nil, nil, 401)
      assert decide(@requested, false, 401)
    end

    # 403 em site público costuma ser bloqueio de robô (WAF): sozinho, não se sabe.
    test "403 não é barreira sozinho: não se sabe" do
      assert LoginWall.decide(%{http_status: 403}) == nil
      assert decide(nil, nil, 403) == nil
    end

    test "outros 4xx e 5xx, sem os outros fatos, não se sabe" do
      for status <- [400, 403, 404, 410, 429, 500, 503, nil] do
        assert LoginWall.decide(%{http_status: status}) == nil, inspect(status)
      end
    end
  end

  describe "campo de senha, redirecionamento e termo de login" do
    # {URL pedida, final_url, barreira?}, todos com campo de senha visível.
    @cases [
      # Home de banco com a caixa de internet banking: redireciona, mas não é tela de login.
      {"https://banco.com.br/", "https://www.banco.com.br/pt/", false},
      {"https://exemplo.com/", "https://exemplo.com/pt/", false},
      {"https://exemplo.com/painel", "https://exemplo.com/entrar.html", true},
      {"https://exemplo.gov.br/servicos", "https://sso.exemplo.gov.br/cas/", true},
      {"https://exemplo.com/painel", "https://exemplo.com/entrar?next=/painel", true},
      {"https://exemplo.com/painel", "https://exemplo.com/Account/LogOn", true},
      {"https://exemplo.com/painel", "https://exemplo.com/users/sign-in", true},
      {"https://exemplo.com/painel", "https://exemplo.com/signin", true},
      {"https://exemplo.com/painel", "https://exemplo.com/acesso-restrito", true},
      {"https://exemplo.com/painel", "https://exemplo.com/auth/realms/x", true},
      {"https://exemplo.com/painel", "https://exemplo.com/minha-conta", true},
      {"https://exemplo.com/painel", "https://exemplo.com/sess%C3%A3o", false},
      {"https://exemplo.com/painel", "https://exemplo.com/sessao/nova", true},
      {"https://exemplo.com/painel", "https://login.exemplo.com/", true},
      {"https://exemplo.com/painel", "https://exemplo.com/session", true},
      # Termo só como pedaço de palavra não conta.
      {"https://exemplo.com/painel", "https://exemplo.com/contato", false},
      {"https://exemplo.com/painel", "https://exemplo.com/blogin", false},
      {"https://exemplo.com/painel", "https://autores.exemplo.com/", false},
      # Na consulta não conta: só caminho e host.
      {"https://exemplo.com/", "https://exemplo.com/pt/?login=1", false},
      # Termo de login, mas sem redirecionamento.
      {"https://exemplo.com/entrar", "https://exemplo.com/entrar/", false}
    ]

    for {requested, final, expected} <- @cases do
      test "#{requested} → #{final}: #{expected}" do
        assert LoginWall.decide(%{
                 requested_url: unquote(requested),
                 final_url: unquote(final),
                 http_status: 200,
                 password_field: true
               }) == unquote(expected)
      end
    end

    test "senha visível sem redirecionamento não é barreira (formulário no cabeçalho)" do
      refute decide(@requested, true)
    end

    test "redirecionamentos comuns contam como o mesmo endereço" do
      for final <- [
            "http://exemplo.com/painel",
            "https://EXEMPLO.com/painel/",
            "https://exemplo.com:443/painel",
            "http://exemplo.com:80/painel",
            "https://exemplo.com/painel?utm=1#topo"
          ] do
        assert decide(final, true) == false, final
      end
    end

    test "redirecionamento para tela de login sem campo de senha não é barreira" do
      refute decide("https://exemplo.com/entrar", false)
      refute decide("https://sso.exemplo.com/", false)
    end

    test "raiz com e sem barra é o mesmo caminho" do
      refute LoginWall.decide(%{
               requested_url: "https://exemplo.com",
               final_url: "https://exemplo.com/",
               password_field: true
             })
    end
  end

  describe "fatos ausentes" do
    test "sem password_field, não se sabe" do
      assert decide("https://exemplo.com/entrar", nil) == nil
      assert LoginWall.decide(%{}) == nil
    end

    test "com senha mas sem URL comparável, não se sabe" do
      assert decide(nil, true) == nil
      assert decide("ftp://exemplo.com/entrar", true) == nil
      assert LoginWall.decide(%{final_url: "https://exemplo.com/", password_field: true}) == nil
    end
  end
end
