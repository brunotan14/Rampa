defmodule Rampa.Audits.FindingTest do
  use Rampa.DataCase, async: true

  import Rampa.AuditsFixtures

  alias Rampa.Audits.Finding

  defp attrs(page, extra) do
    Map.merge(
      %{
        page_id: page.id,
        audit_id: page.audit_id,
        source: :axe,
        rule_id: "image-alt",
        severity: :critical,
        needs_review: false
      },
      extra
    )
  end

  test "recusa trecho de HTML com mais de 2 KB" do
    page = page_fixture()

    changeset =
      Finding.changeset(%Finding{}, attrs(page, %{html_snippet: String.duplicate("é", 1_025)}))

    refute changeset.valid?
    assert %{html_snippet: [_]} = errors_on(changeset)
  end

  test "o banco também recusa trecho de HTML com mais de 2 KB" do
    page = page_fixture()

    assert_raise Ecto.ConstraintError, ~r/html_snippet_max_2kb/, fn ->
      Repo.insert!(struct!(Finding, attrs(page, %{html_snippet: String.duplicate("a", 2_049)})))
    end
  end

  test "recusa severidade fora da lista" do
    page = page_fixture()
    changeset = Finding.changeset(%Finding{}, attrs(page, %{severity: "urgente"}))

    assert %{severity: ["is invalid"]} = errors_on(changeset)
  end

  test "confidence entre 0 e 1" do
    page = page_fixture()

    assert %{confidence: [_]} =
             errors_on(Finding.changeset(%Finding{}, attrs(page, %{confidence: 1.5})))
  end
end
