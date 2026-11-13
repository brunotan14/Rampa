defmodule RampaWeb.ChannelContractTest do
  @moduledoc """
  O contrato do canal `audit:<id>` (`shared/channel-events.schema.json`) e o código não
  divergem: os eventos, os `enum` e os códigos de erro vêm das fontes únicas do backend
  (`Rampa.Audits.Events`, `Rampa.ErrorCodes`, `Rampa.Audits.Audit`, `Rampa.Audits.Finding`),
  e todo payload que `RampaWeb.AuditChannelJSON` monta passa no schema.
  """

  use ExUnit.Case, async: true
  use ExUnitProperties

  import RampaWeb.ChannelContract

  alias Rampa.Audits.{Audit, Events, Finding}
  alias Rampa.Audits.Events.Event
  alias Rampa.ErrorCodes
  alias Rampa.Scanner.Contract
  alias RampaWeb.AuditChannelJSON
  alias RampaWeb.Schemas.AuditError
  alias StreamData, as: SD

  defp definition(name), do: schema()["definitions"][name]
  defp strings(atoms), do: atoms |> Enum.map(&Atom.to_string/1) |> Enum.sort()

  test "é draft-07, versão 1, e declara o tópico e o join" do
    assert schema()["$schema"] == "http://json-schema.org/draft-07/schema#"
    assert schema()["x-channel-version"] == "1"
    assert schema()["x-topic"] == "audit:<id>"

    assert %{"reply" => "#/definitions/JoinReply", "error" => "#/definitions/JoinError"} =
             schema()["x-join"]
  end

  test "x-events são exatamente os eventos que o backend publica" do
    assert Enum.sort(event_names()) == strings(Events.names())
  end

  # RF-RA029: a faixa do status de erro tem uma fonte só, o contrato do scanner.
  test "a faixa do http_status de erro é a do contrato do scanner, no canal, na API e no banco" do
    range = Contract.error_http_status_range()
    assert range == 400..599

    channel = definition("PageError")["properties"]["http_status"]
    assert {channel["minimum"], channel["maximum"]} == {range.first, range.last}

    api = AuditError.schema().properties.http_status
    assert {api.minimum, api.maximum} == {range.first, range.last}

    changeset = fn status ->
      Audit.progress_changeset(%Audit{status: :running}, %{
        error_http_status: status
      })
    end

    for status <- [range.first, range.last], do: assert(changeset.(status).valid?)
    for status <- [200, 399, 600], do: refute(changeset.(status).valid?)
  end

  test "os enum vêm das fontes únicas" do
    assert Enum.sort(definition("JoinError")["properties"]["error"]["properties"]["code"]["enum"]) ==
             strings(ErrorCodes.channel())

    assert Enum.sort(definition("PageError")["properties"]["code"]["enum"]) ==
             strings(ErrorCodes.page())

    assert Enum.sort(definition("AuditStatus")["enum"]) ==
             strings(Ecto.Enum.values(Rampa.Audits.Audit, :status))

    assert Enum.sort(definition("SeverityCounts")["required"]) == strings(Finding.severities())
  end

  test "as recusas do join passam no schema" do
    for code <- ErrorCodes.channel() do
      assert %{"error" => %{"code" => _}} =
               assert_contract(:join_error, AuditChannelJSON.error(code))
    end
  end

  defp counts do
    SD.fixed_map(Map.new(Finding.severities(), &{&1, SD.non_negative_integer()}))
  end

  defp error_code, do: SD.member_of(ErrorCodes.page())

  defp progress do
    SD.fixed_map(%{
      status: SD.member_of(Ecto.Enum.values(Rampa.Audits.Audit, :status)),
      pages_found: SD.non_negative_integer(),
      pages_scanned: SD.non_negative_integer(),
      pages_failed: SD.non_negative_integer(),
      totals_by_severity: counts(),
      needs_review_count: SD.non_negative_integer(),
      error: SD.one_of([SD.constant(nil), error_code()])
    })
  end

  defp data(:status_changed), do: SD.constant(%{status: :running})

  defp data(:page_scanned) do
    SD.fixed_map(%{
      page_id: SD.constant(Ecto.UUID.generate()),
      counts_by_severity: counts(),
      needs_review_count: SD.non_negative_integer()
    })
  end

  defp data(:page_failed),
    do: SD.fixed_map(%{page_id: SD.constant(Ecto.UUID.generate()), error: error_code()})

  defp data(:audit_completed),
    do: SD.fixed_map(%{score: SD.one_of([SD.constant(nil), SD.integer(0..100)])})

  defp data(:audit_failed), do: SD.constant(%{})

  property "todo snapshot que o canal monta passa no schema" do
    check all revision <- SD.non_negative_integer(), progress <- progress() do
      assert_contract(
        :join_reply,
        AuditChannelJSON.snapshot(%{revision: revision, progress: progress})
      )
    end
  end

  property "todo evento que o canal monta passa no schema do seu nome" do
    check all name <- SD.member_of(Events.names()),
              revision <- SD.non_negative_integer(),
              progress <- progress(),
              data <- data(name) do
      event = %Event{
        name: name,
        audit_id: Ecto.UUID.generate(),
        revision: revision,
        progress: progress,
        data: data
      }

      assert_contract(Atom.to_string(name), AuditChannelJSON.event(event))
    end
  end
end
