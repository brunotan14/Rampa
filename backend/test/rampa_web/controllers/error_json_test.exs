defmodule RampaWeb.ErrorJSONTest do
  use ExUnit.Case, async: true

  alias RampaWeb.ErrorJSON

  test "erros do Phoenix saem no formato do PRD §9, com mensagem em português" do
    assert %{error: %{code: "not_found", message: message}} = ErrorJSON.render("404.json", %{})
    assert message =~ "não existe"

    assert %{error: %{code: "internal_error", message: _}} = ErrorJSON.render("500.json", %{})
    assert %{error: %{code: "bad_request"}} = ErrorJSON.render("400.json", %{})
    assert %{error: %{code: "not_acceptable"}} = ErrorJSON.render("406.json", %{})
  end

  test "JSON malformado no corpo vira invalid_body" do
    reason = %Plug.Parsers.ParseError{exception: %Jason.DecodeError{data: "{", position: 1}}

    assert %{error: %{code: "invalid_body"}} =
             ErrorJSON.render("400.json", %{reason: reason})
  end

  test "error/3 acrescenta campos extras" do
    assert %{error: %{code: "audit_not_found", message: _, extra: 1}} =
             ErrorJSON.error(:audit_not_found, [], %{extra: 1})
  end
end
