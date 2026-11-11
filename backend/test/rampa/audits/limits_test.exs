defmodule Rampa.Audits.LimitsTest do
  use ExUnit.Case, async: true

  alias Rampa.Audits.Limits

  test "o dia é o de São Paulo" do
    # 02:00 UTC de 11/11 ainda é 23:00 de 10/11 em São Paulo.
    assert Limits.day_start(~U[2026-11-11 02:00:00Z]) == ~U[2026-11-10 03:00:00Z]
    assert Limits.next_day_start(~U[2026-11-11 02:00:00Z]) == ~U[2026-11-11 03:00:00Z]

    assert Limits.day_start(~U[2026-11-11 03:00:00Z]) == ~U[2026-11-11 03:00:00Z]
    assert Limits.next_day_start(~U[2026-11-11 03:00:00Z]) == ~U[2026-11-12 03:00:00Z]
  end

  test "usa a base de fusos: no horário de verão de 2018 a meia-noite era 02:00 UTC" do
    # Em 2018 São Paulo estava em UTC-2 em dezembro, e o dia 4/11 começou à 01:00 (salto).
    assert Limits.day_start(~U[2018-12-10 12:00:00Z]) == ~U[2018-12-10 02:00:00Z]
    assert Limits.day_start(~U[2018-11-04 12:00:00Z]) == ~U[2018-11-04 03:00:00Z]
  end

  test "ceil_minute/1 arredonda para cima" do
    assert Limits.ceil_minute(~U[2026-11-10 17:32:00Z]) == ~U[2026-11-10 17:32:00Z]
    assert Limits.ceil_minute(~U[2026-11-10 17:32:01Z]) == ~U[2026-11-10 17:33:00Z]
    assert Limits.ceil_minute(~U[2026-11-10 23:59:30.5Z]) == ~U[2026-11-11 00:00:00Z]
  end

  test "local_time/1 mostra HH:MM em São Paulo" do
    assert Limits.local_time(~U[2026-11-10 17:32:00Z]) == "14:32"
    assert Limits.local_time(~U[2026-11-11 02:05:00Z]) == "23:05"
  end

  test "config/1 lê a configuração e aceita sobrescrita" do
    assert %{per_ip_per_hour: 5, daily: 50} = Limits.config()
    assert %{per_ip_per_hour: 2, daily: 50} = Limits.config(per_ip_per_hour: 2)
  end
end
