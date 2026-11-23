defmodule Rampa.Audits.PurgeExpiredJobTest do
  @moduledoc """
  RF-RA014: o job diário da retenção (`Rampa.Audits.PurgeExpiredJob`).
  """

  use Rampa.DataCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Rampa.AuditsFixtures

  alias Rampa.Audits.{Audit, PurgeExpiredJob}

  defp exists?(%Audit{id: id}), do: Repo.exists?(from a in Audit, where: a.id == ^id)

  describe "configuração" do
    setup do
      %{oban: Application.fetch_env!(:rampa, Oban)}
    end

    test "fila maintenance, três tentativas, sem args e uma execução por vez" do
      assert %{queue: "maintenance", max_attempts: 3, args: %{}} =
               PurgeExpiredJob.new(%{}).changes

      assert {:ok, first} = Oban.insert(PurgeExpiredJob.new(%{}))
      assert {:ok, second} = Oban.insert(PurgeExpiredJob.new(%{}))
      assert second.conflict?
      assert second.id == first.id
    end

    test "o Cron agenda o job uma vez por dia, às 06:17 UTC", %{oban: oban} do
      assert {"17 6 * * *", PurgeExpiredJob} in oban[:cron][:crontab]
    end

    test "timeout de 4 min, abaixo do rescue_after do Lifeline: job vivo nunca é resgatado",
         %{oban: oban} do
      rescue_after = Oban.Period.to_milliseconds(oban[:lifeline][:rescue_after])
      timeout = PurgeExpiredJob.timeout(%Oban.Job{})

      assert timeout == :timer.minutes(4)
      assert rescue_after > timeout
    end
  end

  describe "perform/1" do
    setup do
      ref = make_ref()
      parent = self()

      :telemetry.attach(
        ref,
        [:rampa, :retention, :purge],
        fn _event, measurements, metadata, _config ->
          send(parent, {:purge, measurements, metadata})
        end,
        nil
      )

      on_exit(fn -> :telemetry.detach(ref) end)
    end

    test "CA2.2 apaga a vencida, mantém a do prazo e emite a telemetria" do
      now = DateTime.utc_now(:second)
      expired = audit_fixture(%{expires_at: DateTime.add(now, -1, :day)})
      kept = audit_fixture(%{expires_at: DateTime.add(now, 1, :day)})

      assert :ok = perform_job(PurgeExpiredJob, %{})

      refute exists?(expired)
      assert exists?(kept)

      assert_receive {:purge, %{deleted: deleted, batches: batches}, %{more?: false}}
      assert deleted >= 1 and batches >= 1
    end

    test "FR-014 sem nada vencido não apaga nada e termina :ok" do
      kept = audit_fixture(%{expires_at: DateTime.add(DateTime.utc_now(:second), 1, :day)})

      assert :ok = perform_job(PurgeExpiredJob, %{})
      assert exists?(kept)
      assert_receive {:purge, %{deleted: deleted, batches: 1}, %{more?: false}}
      assert is_integer(deleted)
    end
  end
end
