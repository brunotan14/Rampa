defmodule Rampa.Audits.ReconcileTasksJob do
  @moduledoc """
  Reconcilia tarefas presas de auditorias abertas (`Rampa.Audits.reconcile_stale_tasks/1`;
  ciclo de vida em `Rampa.Audits.Rules`). Roda na fila `maintenance`, agendado pelo
  `Oban.Cron` em `config/config.exs`.

  Cobre o que o `Oban.Lifeline` não cobre: job descartado na última tentativa com a tarefa
  ainda `running`, job apagado, estado que não chegou a ser gravado. Uma execução por vez
  (`unique` nos estados não finais); rodar duas vezes seguidas dá o mesmo estado.
  """

  use Oban.Worker,
    queue: :maintenance,
    max_attempts: 3,
    unique: [period: :infinity, states: :incomplete]

  require Logger

  alias Rampa.Audits

  @impl Oban.Worker
  def perform(%Oban.Job{}) do
    case Audits.reconcile_stale_tasks() do
      %{requeued: 0, failed: 0, error: 0} ->
        :ok

      result ->
        Logger.warning("reconciliação de tarefas: #{inspect(result)}")
        :ok
    end
  end
end
