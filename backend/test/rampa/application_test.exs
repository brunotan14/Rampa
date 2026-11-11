defmodule Rampa.ApplicationTest do
  # `async: false`: muda a configuração global do app.
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  @keys [:env, :ip_hash_secret, :trusted_proxies, :ssrf_allowlist]

  setup do
    previous = Map.new(@keys, &{&1, Application.get_env(:rampa, &1)})

    on_exit(fn ->
      Enum.each(previous, fn {key, value} -> Application.put_env(:rampa, key, value) end)
    end)
  end

  # As checagens de subida falham antes de qualquer filho iniciar: chamar `start/2` com o app
  # já rodando não sobe nada de novo.
  defp start, do: Rampa.Application.start(:normal, [])

  test "RF-RA002: em produção, sem IP_HASH_SECRET, o app não sobe e explica o motivo" do
    Application.put_env(:rampa, :env, :prod)
    Application.put_env(:rampa, :ip_hash_secret, nil)
    Application.put_env(:rampa, :trusted_proxies, "172.18.0.0/16")

    log =
      capture_log(fn ->
        assert {:error, reason} = start()
        assert reason =~ "IP_HASH_SECRET"
      end)

    assert log =~ "IP_HASH_SECRET não está definida"
  end

  test "TRUSTED_PROXIES inválida impede a subida" do
    Application.put_env(:rampa, :trusted_proxies, "traefik")

    capture_log(fn ->
      assert {:error, reason} = start()
      assert reason =~ "TRUSTED_PROXIES"
    end)
  end

  test "em produção, SSRF_ALLOWLIST preenchida continua impedindo a subida" do
    Application.put_env(:rampa, :env, :prod)
    Application.put_env(:rampa, :ssrf_allowlist, "fixtures")

    capture_log(fn -> assert {:error, "SSRF_ALLOWLIST" <> _} = start() end)
  end
end
