defmodule Rampa.Audits.ConstraintsTest do
  @moduledoc """
  Invariantes do banco (PRD §8; ciclo de vida em Rampa.Audits.Rules). Cada teste faz
  uma gravação que o banco tem de recusar, sem passar pelos changesets: as tabelas são
  alteradas pelo nome, com valores em texto.
  """

  use Rampa.DataCase, async: true

  import Rampa.AuditsFixtures

  alias Rampa.Audits.{Audit, Finding, Page, PageTask}

  # Atualiza uma linha pelo nome da tabela, sem o schema (e sem o `Ecto.Enum`).
  defp update_raw(table, id, set) do
    Repo.update_all(from(r in table, where: r.id == type(^id, Ecto.UUID)), set: set)
  end

  # `Repo.insert!` sem changeset levanta `Ecto.ConstraintError`; `update_all` e `insert_all`,
  # `Postgrex.Error`. Os dois dizem qual constraint foi violada.
  defp assert_violates(constraint, fun) do
    name = Atom.to_string(constraint)

    try do
      Repo.transact(fn -> {:ok, fun.()} end)
      flunk("esperava violar #{name}")
    rescue
      error in Postgrex.Error -> assert error.postgres.constraint == name
      error in Ecto.ConstraintError -> assert error.constraint == name
    end
  end

  defp finding_attrs(page, extra \\ %{}) do
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

  describe "audits" do
    test "status fora da lista" do
      audit = audit_fixture()
      assert_violates(:status_valid, fn -> update_raw("audits", audit.id, status: "paused") end)
    end

    for counter <- [:pages_found, :pages_scanned, :pages_failed] do
      test "#{counter} negativo" do
        audit = audit_fixture()

        assert_violates(:counters_non_negative, fn ->
          update_raw("audits", audit.id, [{unquote(counter), -1}])
        end)
      end
    end

    for status <- ["completed", "failed"] do
      test "#{status} sem finished_at" do
        audit = audit_fixture()

        assert_violates(:finished_requires_finished_at, fn ->
          update_raw("audits", audit.id, status: unquote(status))
        end)
      end
    end

    test "cancelled e as abertas não exigem finished_at" do
      audit = audit_fixture()

      for status <- ["queued", "running", "cancelled"] do
        assert {1, _} = update_raw("audits", audit.id, status: status)
      end
    end

    test "o changeset recusa auditoria encerrada sem finished_at" do
      changeset = Audit.progress_changeset(audit_fixture(), %{status: :completed})
      assert %{finished_at: [_]} = errors_on(changeset)
    end
  end

  describe "pages" do
    test "status fora da lista" do
      page = page_fixture()
      assert_violates(:status_valid, fn -> update_raw("pages", page.id, status: "paused") end)
    end

    for http_status <- [99, 600, 0] do
      test "http_status #{http_status}" do
        page = page_fixture()

        assert_violates(:http_status_range, fn ->
          update_raw("pages", page.id, http_status: unquote(http_status))
        end)
      end
    end

    test "http_status nulo ou entre 100 e 599 passa" do
      page = page_fixture()

      for http_status <- [nil, 100, 599] do
        assert {1, _} = update_raw("pages", page.id, http_status: http_status)
      end
    end

    for status <- ["analyzing", "done"], missing <- [:scanned_at, :axe_version] do
      test "#{status} sem #{missing}" do
        page = page_fixture(%{status: :done})

        assert_violates(:scanned_requires_scan_data, fn ->
          update_raw("pages", page.id, [{:status, unquote(status)}, {unquote(missing), nil}])
        end)
      end
    end

    test "failed sem error" do
      page = page_fixture()

      assert_violates(:failed_requires_error, fn ->
        update_raw("pages", page.id, status: "failed")
      end)
    end

    test "o changeset recusa done sem os dados do scan e failed sem erro" do
      page = page_fixture()

      assert %{axe_version: [_], scanned_at: [_]} =
               errors_on(Page.progress_changeset(page, %{status: :done}))

      assert %{error: [_]} = errors_on(Page.progress_changeset(page, %{status: :failed}))
    end
  end

  describe "findings" do
    test "source fora da lista" do
      page = page_fixture()
      finding = Repo.insert!(struct!(Finding, finding_attrs(page)))

      assert_violates(:source_valid, fn ->
        update_raw("findings", finding.id, source: "manual")
      end)
    end

    test "severity fora da lista" do
      page = page_fixture()
      finding = Repo.insert!(struct!(Finding, finding_attrs(page)))

      assert_violates(:severity_valid, fn ->
        update_raw("findings", finding.id, severity: "urgent")
      end)
    end

    test "audit_id diferente do da página" do
      page = page_fixture()
      other = audit_fixture()

      assert_violates(:findings_page_id_fkey, fn ->
        Repo.insert_all(Finding, [
          finding_attrs(page, %{
            id: Ecto.UUID.generate(),
            audit_id: other.id,
            inserted_at: DateTime.utc_now(:second),
            updated_at: DateTime.utc_now(:second)
          })
        ])
      end)
    end

    test "o changeset devolve erro em vez de levantar" do
      page = page_fixture()
      attrs = finding_attrs(page, %{audit_id: audit_fixture().id})

      assert {:error, changeset} = Repo.insert(Finding.changeset(%Finding{}, attrs))
      assert %{page_id: ["does not exist"]} = errors_on(changeset)
    end
  end

  describe "page_tasks" do
    test "kind fora da lista" do
      page = page_fixture()
      assert_violates(:kind_valid, fn -> update_raw("page_tasks", scan(page).id, kind: "seo") end)
    end

    test "status fora da lista" do
      page = page_fixture()

      assert_violates(:status_valid, fn ->
        update_raw("page_tasks", scan(page).id, status: "paused")
      end)
    end

    test "attempt negativo" do
      page = page_fixture()

      assert_violates(:attempt_non_negative, fn ->
        update_raw("page_tasks", scan(page).id, attempt: -1)
      end)
    end

    test "running sem started_at" do
      page = page_fixture()

      assert_violates(:running_requires_started_at, fn ->
        update_raw("page_tasks", scan(page).id, status: "running")
      end)
    end

    for status <- ["done", "failed"] do
      test "#{status} sem finished_at" do
        page = page_fixture()

        assert_violates(:finished_requires_finished_at, fn ->
          update_raw("page_tasks", scan(page).id, status: unquote(status), error: "x")
        end)
      end
    end

    test "failed sem error" do
      page = page_fixture()

      assert_violates(:failed_requires_error, fn ->
        update_raw("page_tasks", scan(page).id,
          status: "failed",
          finished_at: DateTime.utc_now(:second)
        )
      end)
    end

    test "uma tarefa de cada tipo por página" do
      page = page_fixture()

      assert_violates(:page_tasks_page_id_kind_index, fn ->
        task_fixture(page, %{kind: :scan})
      end)
    end

    test "audit_id diferente do da página" do
      page = page_fixture()
      other = audit_fixture()

      assert_violates(:page_tasks_page_id_fkey, fn ->
        Repo.insert_all(PageTask, [
          %{
            id: Ecto.UUID.generate(),
            page_id: page.id,
            audit_id: other.id,
            kind: :alt_text,
            status: :pending,
            attempt: 0,
            inserted_at: DateTime.utc_now(:second),
            updated_at: DateTime.utc_now(:second)
          }
        ])
      end)
    end

    test "o changeset devolve erro para tarefa repetida" do
      page = page_fixture()

      assert {:error, changeset} =
               Repo.insert(PageTask.create_changeset(page, %{kind: :scan}))

      assert %{page_id: ["has already been taken"]} = errors_on(changeset)
    end
  end

  test "apagar a auditoria apaga páginas, tarefas e achados" do
    page = page_fixture()
    Repo.insert!(struct!(Finding, finding_attrs(page)))

    Repo.delete!(Repo.get!(Audit, page.audit_id))

    assert Repo.aggregate(Page, :count) == 0
    assert Repo.aggregate(PageTask, :count) == 0
    assert Repo.aggregate(Finding, :count) == 0
  end

  defp scan(page), do: Repo.get_by!(PageTask, page_id: page.id, kind: :scan)
end
