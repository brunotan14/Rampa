defmodule Rampa.Audits.RetentionTest do
  @moduledoc """
  RF-RA014, retenção de 90 dias: o prazo vem de uma fonte só (`Rampa.Audits.retention_days/0`)
  e a limpeza (`Rampa.Audits.purge_expired/1`) apaga as auditorias vencidas com páginas,
  tarefas e achados.

  `async: false`: alguns testes mudam `config :rampa, :retention_days`, que é global. O relógio
  da limpeza é injetado (`now:`) com datas do ano 2000, longe de qualquer auditoria de outro
  teste. A limpeza com auditoria travada por outra conexão está em
  `Rampa.Audits.RetentionConcurrencyTest` (fora do sandbox).
  """

  use Rampa.DataCase, async: false

  import ExUnit.CaptureLog
  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Finding, LoginWallDaily, Page, PageTask}

  @now ~U[2000-06-01 12:00:00Z]

  setup do
    previous = Application.get_env(:rampa, :retention_days)
    on_exit(fn -> Application.put_env(:rampa, :retention_days, previous) end)
  end

  defp days_ago(days), do: DateTime.add(@now, -days, :day)

  # Auditoria com uma página varrida, a tarefa `scan` e dois achados.
  defp audit_with_children(attrs) do
    audit = audit_fixture(Map.merge(%{status: :completed}, attrs))
    page = page_fixture(%{audit: audit, status: :done})
    finding_fixture(page)
    finding_fixture(page, %{rule_id: "link-name", wcag_criteria: ["2.4.4"]})
    audit
  end

  # Tudo o que pertence à auditoria, para conferir que sumiu ou ficou igual.
  defp children(%Audit{id: id}) do
    {
      Repo.all(from p in Page, where: p.audit_id == ^id, order_by: p.id),
      Repo.all(from t in PageTask, where: t.audit_id == ^id, order_by: t.id),
      Repo.all(from f in Finding, where: f.audit_id == ^id, order_by: f.id)
    }
  end

  defp exists?(%Audit{id: id}), do: Repo.exists?(from a in Audit, where: a.id == ^id)

  describe "retention_days/0 (fonte única)" do
    test "CA2.1 o prazo configurado é de 90 dias" do
      assert Audits.retention_days() == 90
    end

    test "CA2.1 lê a configuração a cada chamada" do
      Application.put_env(:rampa, :retention_days, 30)
      assert Audits.retention_days() == 30
    end

    for invalid <- [nil, 1, 0, -90, 90.0, "90"] do
      test "CA2.1 #{inspect(invalid)} é recusado" do
        Application.put_env(:rampa, :retention_days, unquote(invalid))

        assert_raise ArgumentError, ~r/retention_days/, fn -> Audits.retention_days() end

        log = capture_log(fn -> assert {:error, _reason} = Audits.check_retention_startup() end)
        assert log =~ "retention_days"
      end
    end

    test "CA2.1 valor inválido impede a subida do app" do
      Application.put_env(:rampa, :retention_days, 1)

      capture_log(fn ->
        assert {:error, reason} = Rampa.Application.start(:normal, [])
        assert reason =~ "retention_days"
      end)
    end

    test "CA2.1 valor válido passa na checagem de subida" do
      assert :ok = Audits.check_retention_startup()
    end
  end

  describe "purge_expired/1" do
    test "CA2.2 a vencida some com páginas, tarefas e achados; a que está no prazo fica intacta" do
      expired = audit_with_children(%{expires_at: DateTime.add(@now, -1)})
      kept = audit_with_children(%{expires_at: DateTime.add(@now, 1)})
      kept_children = children(kept)

      assert %{deleted: 1, batches: 1, more?: false} = Audits.purge_expired(now: @now)

      refute exists?(expired)
      assert children(expired) == {[], [], []}

      assert Repo.get!(Audit, kept.id) == kept
      assert children(kept) == kept_children
      assert {[_page], [_task], [_, _]} = kept_children
    end

    test "CA2.2 expires_at igual ao instante da limpeza ainda não venceu" do
      audit = audit_fixture(%{expires_at: @now})

      assert %{deleted: 0} = Audits.purge_expired(now: @now)
      assert exists?(audit)
    end

    test "CA2.2 sem expires_at, vence pelo inserted_at mais o prazo configurado" do
      old = audit_with_children(%{inserted_at: days_ago(91), updated_at: days_ago(91)})
      recent = audit_fixture(%{inserted_at: days_ago(89), updated_at: days_ago(89)})

      assert %{deleted: 1} = Audits.purge_expired(now: @now)

      refute exists?(old)
      assert children(old) == {[], [], []}
      assert exists?(recent)

      # O mesmo prazo da criação: com 30 dias, a de 89 dias também vence.
      Application.put_env(:rampa, :retention_days, 30)
      assert %{deleted: 1} = Audits.purge_expired(now: @now)
      refute exists?(recent)
    end

    test "CA2.2 auditoria ainda aberta também é apagada quando vence" do
      audit = audit_fixture(%{status: :running, expires_at: days_ago(1)})
      page_fixture(%{audit: audit, status: :scanning})

      assert %{deleted: 1} = Audits.purge_expired(now: @now)
      refute exists?(audit)
      assert children(audit) == {[], [], []}
    end

    test "CA2.5 a medição diária de login continua igual depois da limpeza" do
      audit = audit_fixture(%{status: :running})
      page = page_fixture(%{audit: audit, status: :scanning})
      assert {:ok, _page} = Audits.record_scan_result(page, scanner_response("limpa"))
      assert %Audit{status: :completed} = Repo.get!(Audit, audit.id)

      before = Repo.all(from d in LoginWallDaily, order_by: d.day)
      assert before != []

      # A auditoria acabou de ser criada: vence 90 dias depois.
      far = DateTime.add(DateTime.utc_now(:second), 91, :day)
      assert %{deleted: deleted} = Audits.purge_expired(now: far)
      assert deleted >= 1

      refute exists?(audit)
      assert Repo.all(from d in LoginWallDaily, order_by: d.day) == before
    end

    test "FR-014 a segunda execução não apaga mais nada" do
      expired = audit_with_children(%{expires_at: days_ago(1)})
      kept = audit_with_children(%{expires_at: DateTime.add(@now, 3600)})
      kept_children = children(kept)

      assert %{deleted: 1} = Audits.purge_expired(now: @now)
      assert %{deleted: 0, batches: 1, more?: false} = Audits.purge_expired(now: @now)

      refute exists?(expired)
      assert Repo.get!(Audit, kept.id) == kept
      assert children(kept) == kept_children
    end

    test "FR-014 o teto de lotes deixa o resto para a próxima execução" do
      expired = for _ <- 1..5, do: audit_with_children(%{expires_at: days_ago(1)})
      kept = audit_fixture(%{expires_at: DateTime.add(@now, 1)})

      assert %{deleted: 4, batches: 2, more?: true} =
               Audits.purge_expired(now: @now, batch_size: 2, max_batches: 2)

      assert Enum.count(expired, &exists?/1) == 1

      assert %{deleted: 1, batches: 1, more?: false} =
               Audits.purge_expired(now: @now, batch_size: 2, max_batches: 2)

      assert Enum.map(expired, &children/1) == List.duplicate({[], [], []}, 5)
      refute Enum.any?(expired, &exists?/1)
      assert exists?(kept)
    end

    test "FR-014 teto atingido sem vencida sobrando não acusa more?" do
      for _ <- 1..4, do: audit_fixture(%{expires_at: days_ago(1)})

      assert %{deleted: 4, batches: 2, more?: false} =
               Audits.purge_expired(now: @now, batch_size: 2, max_batches: 2)
    end

    test "FR-014 opções inválidas são recusadas antes de apagar" do
      audit = audit_fixture(%{expires_at: days_ago(1)})

      for opts <- [[batch_size: 0], [max_batches: -1], [batch_size: "20"]] do
        assert_raise ArgumentError, fn -> Audits.purge_expired([now: @now] ++ opts) end
      end

      assert exists?(audit)
    end
  end
end
