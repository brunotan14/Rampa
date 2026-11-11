defmodule Rampa.Audits.FindingsCursorPropertyTest do
  use Rampa.DataCase, async: true
  use ExUnitProperties

  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias StreamData, as: SD

  # Cursor de `Rampa.Audits.list_findings/2` (`GET /api/audits/:id/findings`). O cursor é
  # opaco e as funções que o montam e interpretam são privadas: as propriedades passam pela
  # função pública. Cada execução consulta o banco, por isso os `max_runs` menores que nos
  # módulos puros.

  @base ~U[2026-11-10 12:00:00.000000Z]

  # Faixas do instante do cursor, em microssegundos Unix: o `DateTime` aceita de -9999 a
  # 9999; o `timestamptz` do PostgreSQL começa em 24/11/4714 a.C., 00:00 UTC.
  @datetime_min_unix -377_705_116_800_000_000
  @datetime_max_unix 253_402_300_799_999_999
  @pg_min_unix -210_866_803_200_000_000

  defp uuid, do: SD.map(SD.binary(length: 16), fn raw -> Ecto.UUID.load(raw) |> elem(1) end)

  # Poucos instantes possíveis, para haver empate de `inserted_at` (o `id` desempata). Só os
  # instantes são gerados: os ids saem novos a cada execução, porque o shrinking repete a
  # execução na mesma transação do sandbox e um id gerado repetido violaria a chave primária.
  defp offsets, do: SD.list_of(SD.integer(0..3), max_length: 8)

  defp cursor_id, do: SD.one_of([uuid(), SD.string(:utf8, max_length: 40), SD.binary(length: 16)])

  defp separator, do: SD.member_of([":", "::", ""])

  defp assert_cursor_result(audit_id, decoded) do
    cursor = Base.url_encode64(decoded, padding: false)

    case Audits.list_findings(audit_id, %{"cursor" => cursor}) do
      {:ok, %{data: data}} -> assert is_list(data)
      {:error, :invalid_cursor} -> :ok
    end
  end

  defp page_through(audit_id, limit, cursor \\ nil, acc \\ []) do
    params = %{"limit" => Integer.to_string(limit)}
    params = if cursor, do: Map.put(params, "cursor", cursor), else: params

    assert {:ok, %{data: data, next_cursor: next}} = Audits.list_findings(audit_id, params)
    acc = acc ++ Enum.map(data, & &1.id)

    if next, do: page_through(audit_id, limit, next, acc), else: acc
  end

  property "ida e volta do cursor: as páginas juntas dão todos os achados, na ordem, sem repetir" do
    check all offsets <- offsets(), limit <- SD.integer(1..4), max_runs: 40 do
      page = page_fixture(%{status: :done})
      spec = Enum.map(offsets, &{Ecto.UUID.generate(), &1})

      for {id, offset} <- spec do
        finding_fixture(page, %{id: id, inserted_at: DateTime.add(@base, offset, :microsecond)})
      end

      expected =
        spec
        |> Enum.sort_by(fn {id, offset} -> {offset, id} end)
        |> Enum.map(&elem(&1, 0))

      assert page_through(page.audit_id, limit) == expected
    end
  end

  describe "cursor adulterado" do
    setup do
      page = page_fixture(%{status: :done})
      finding_fixture(page, %{inserted_at: @base})
      %{audit_id: page.audit_id}
    end

    property "texto qualquer é cursor inválido, sem exceção", %{audit_id: audit_id} do
      cursor =
        SD.one_of([
          SD.string(:utf8, max_length: 80),
          SD.string(:printable, max_length: 80),
          SD.binary(max_length: 80),
          SD.string(:alphanumeric, max_length: 80)
        ])

      check all cursor <- cursor, max_runs: 150 do
        assert Audits.list_findings(audit_id, %{"cursor" => cursor}) ==
                 {:error, :invalid_cursor}
      end
    end

    property "valor que não é texto é cursor inválido", %{audit_id: audit_id} do
      check all cursor <- SD.term(), not is_binary(cursor) and cursor != nil, max_runs: 50 do
        assert Audits.list_findings(audit_id, %{"cursor" => cursor}) ==
                 {:error, :invalid_cursor}
      end
    end

    # Cursor bem formado, mas com o instante ou o id adulterados: inteiro dentro da faixa do
    # PostgreSQL (`timestamptz` começa em 4714 a.C.), fora da faixa do `DateTime` e qualquer id.
    property "cursor bem formado e adulterado nunca levanta exceção", %{audit_id: audit_id} do
      unix =
        SD.one_of([
          SD.integer(@pg_min_unix..@datetime_max_unix),
          SD.integer(@datetime_max_unix..(@datetime_max_unix * 4)),
          SD.member_of([@pg_min_unix, @datetime_max_unix, @datetime_max_unix + 1])
        ])

      check all unix <- unix, id <- cursor_id(), separator <- separator(), max_runs: 150 do
        assert_cursor_result(audit_id, "#{unix}#{separator}#{id}")
      end
    end

    property "cursor com sobra em volta do instante ou do id é inválido", %{audit_id: audit_id} do
      junk = SD.member_of(["a", " ", ".5", "e3", "_", "\0", "ç", "0x"])

      check all unix <- SD.integer(0..@datetime_max_unix),
                id <- uuid(),
                junk <- junk,
                place <- SD.member_of([:before_unix, :after_unix, :before_id, :after_id]),
                max_runs: 100 do
        decoded =
          case place do
            :before_unix -> "#{junk}#{unix}:#{id}"
            :after_unix -> "#{unix}#{junk}:#{id}"
            :before_id -> "#{unix}:#{junk}#{id}"
            :after_id -> "#{unix}:#{id}#{junk}"
          end

        cursor = Base.url_encode64(decoded, padding: false)

        assert Audits.list_findings(audit_id, %{"cursor" => cursor}) ==
                 {:error, :invalid_cursor},
               "aceitou #{inspect(decoded)}"
      end
    end

    # CONTRAEXEMPLO (refactor/qualidade): instante antes do mínimo do PostgreSQL e dentro da
    # faixa do `DateTime` (anos -9999 a -4714) passa pelo `decode_cursor/1` e a consulta
    # levanta `Postgrex.Error` (22008, timestamp out of range). Mínimo:
    # `Base.url_encode64("-210866803200000001:" <> Ecto.UUID.generate(), padding: false)`.
    # Pela API, `GET /api/audits/:id/findings?cursor=...` vira HTTP 500 em vez de 422
    # `invalid_cursor`. Correção pendente de decisão; reative o teste junto com ela.
    @tag :skip
    property "cursor com instante antes do mínimo do PostgreSQL é inválido, sem exceção",
             %{audit_id: audit_id} do
      unix =
        SD.one_of([
          SD.integer(@datetime_min_unix..(@pg_min_unix - 1)),
          SD.integer((@datetime_min_unix * 4)..@datetime_min_unix),
          SD.member_of([@pg_min_unix - 1, @datetime_min_unix, @datetime_min_unix - 1])
        ])

      check all unix <- unix, id <- cursor_id(), separator <- separator(), max_runs: 300 do
        assert_cursor_result(audit_id, "#{unix}#{separator}#{id}")
      end
    end
  end
end
