defmodule Rampa.Audits.PurgeExpiredJob do
  @moduledoc """
  Retenção (RF-RA014): apaga as auditorias vencidas, com páginas, tarefas e achados
  (`Rampa.Audits.purge_expired/1`). Roda na fila `maintenance`, uma vez por dia, agendado pelo
  `Oban.Cron` em `config/config.exs`. Sem `args`.

  Uma execução por vez (`unique` nos estados não finais). Cada lote é uma transação: repetir o
  job, ou interrompê-lo no meio, não apaga nada que não venceu nem deixa página ou achado
  órfão. O teto de lotes por execução deixa o resto para o dia seguinte, com `warning` no log.

  `timeout/1` (4 min) fica abaixo do `rescue_after` do `Oban.Lifeline` (5 min): um job vivo
  nunca é resgatado e executado em dobro.

  Telemetria: `[:rampa, :retention, :purge]` com as medidas `%{deleted: n, batches: b}` e o
  metadado `%{more?: boolean}`.
  """

  use Oban.Worker,
    queue: :maintenance,
    max_attempts: 3,
    unique: [period: :infinity, states: :incomplete]

  require Logger

  alias Rampa.Audits

  @timeout_ms :timer.minutes(4)

  @impl Oban.Worker
  def timeout(_job), do: @timeout_ms

  @impl Oban.Worker
  def perform(%Oban.Job{}) do
    %{deleted: deleted, batches: batches, more?: more?} = Audits.purge_expired()

    :telemetry.execute(
      [:rampa, :retention, :purge],
      %{deleted: deleted, batches: batches},
      %{more?: more?}
    )

    Logger.info("retenção: #{deleted} auditoria(s) vencida(s) apagada(s) em #{batches} lote(s)")

    if more? do
      Logger.warning(
        "retenção: o teto de lotes por execução foi atingido; as auditorias vencidas que " <>
          "sobraram saem na próxima execução"
      )
    end

    :ok
  end
end
