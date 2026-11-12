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
    for status <- [401, 403] do
      test "#{status} é barreira, com ou sem os outros fatos" do
        status = unquote(status)
        assert LoginWall.decide(%{http_status: status})
        assert decide(nil, nil, status)
        assert decide(@requested, false, status)
      end
    end

    test "outros 4xx e 5xx, sem os outros fatos, não se sabe" do
      for status <- [400, 404, 410, 429, 500, 503, nil] do
        assert LoginWall.decide(%{http_status: status}) == nil, inspect(status)
      end
    end
  end

  describe "campo de senha e redirecionamento" do
    test "senha visível depois de ir para outro caminho é barreira" do
      assert decide("https://exemplo.com/entrar?next=/painel", true)
    end

    test "senha visível depois de ir para outra origem é barreira" do
      assert decide("https://sso.exemplo.com/login", true)
      assert decide("https://exemplo.com:8443/painel", true)
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

    test "redirecionamento sem campo de senha não é barreira" do
      refute decide("https://exemplo.com/pt-br/", false)
      refute decide("https://outra.exemplo.com/", false)
    end

    test "raiz com e sem barra é o mesmo caminho" do
      refute LoginWall.decide(%{
               requested_url: "https://exemplo.com",
               final_url: "https://exemplo.com/",
               password_field: true
             })
    end

    test "o caminho diferencia maiúsculas" do
      assert decide("https://exemplo.com/Painel", true)
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
