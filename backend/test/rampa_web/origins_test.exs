defmodule RampaWeb.OriginsTest do
  @moduledoc """
  RF-RA004: origens aceitas no websocket `/socket` em produção (`PHX_HOST` e
  `PHX_ALLOWED_ORIGINS`).
  """

  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias RampaWeb.Origins

  @key {Origins, :origins}

  setup do
    previous = :persistent_term.get(@key, :none)

    on_exit(fn ->
      if previous == :none,
        do: :persistent_term.erase(@key),
        else: :persistent_term.put(@key, previous)
    end)
  end

  describe "parse/2" do
    test "a origem do app é https://<PHX_HOST>, em minúsculas" do
      assert {:ok, ["https://rampa.exemplo.com.br"]} = Origins.parse("Rampa.Exemplo.com.br", nil)
      assert {:ok, ["https://rampa.exemplo.com.br"]} = Origins.parse("rampa.exemplo.com.br", " ")
    end

    test "acrescenta as origens extras, normalizadas e sem repetir" do
      assert {:ok, origins} =
               Origins.parse(
                 "app",
                 "http://app-via-proxy:4000, https://APP, https://staging.exemplo.com:443/,http://x:80"
               )

      assert origins == [
               "https://app",
               "http://app-via-proxy:4000",
               "https://staging.exemplo.com",
               "http://x"
             ]
    end

    test "recusa curinga, caminho, usuário, consulta, outro esquema e host vazio" do
      for invalid <- [
            "*",
            "https://*.exemplo.com",
            "https://exemplo.com/painel",
            "https://usuario@exemplo.com",
            "https://exemplo.com?a=1",
            "ftp://exemplo.com",
            "exemplo.com",
            "https://"
          ] do
        assert {:error, [^invalid]} = Origins.parse("app", invalid), invalid
      end
    end

    test "PHX_HOST ausente ou vazio é inválido" do
      assert {:error, ["PHX_HOST=nil"]} = Origins.parse(nil, nil)
      assert {:error, ["PHX_HOST=\"\"" | _]} = Origins.parse("", "*")
    end
  end

  describe "load/1 e allowed?/1" do
    test "sem configuração (dev e testes) não carrega nada" do
      assert :ok = Origins.load(nil)
    end

    test "valor inválido impede a subida e vai para o log" do
      log =
        capture_log(fn ->
          assert {:error, reason} = Origins.load(host: "app", extra: "*")
          assert reason =~ "sem curinga"
        end)

      assert log =~ "Origens do websocket inválidas"
    end

    test "aceita só as origens carregadas, comparando esquema, host e porta" do
      assert :ok = Origins.load(host: "rampa.exemplo.com.br", extra: "http://app-via-proxy:4000")

      assert Origins.allowed?(URI.parse("https://rampa.exemplo.com.br"))
      assert Origins.allowed?(URI.parse("https://RAMPA.exemplo.com.br:443"))
      assert Origins.allowed?(URI.parse("http://app-via-proxy:4000"))

      refute Origins.allowed?(URI.parse("http://rampa.exemplo.com.br"))
      refute Origins.allowed?(URI.parse("https://rampa.exemplo.com.br:8443"))
      refute Origins.allowed?(URI.parse("https://outro.exemplo.com.br"))
      refute Origins.allowed?(URI.parse("http://app-via-proxy:4001"))
      refute Origins.allowed?(URI.parse("null"))
    end

    test "sem load/1, recusa tudo" do
      :persistent_term.erase(@key)
      refute Origins.allowed?(URI.parse("https://rampa.exemplo.com.br"))
    end
  end
end
