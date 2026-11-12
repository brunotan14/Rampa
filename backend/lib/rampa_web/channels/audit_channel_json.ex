defmodule RampaWeb.AuditChannelJSON do
  @moduledoc """
  Payloads do canal `audit:<id>` (RF-RA004), no formato de
  `shared/channel-events.schema.json`. Só identificadores e contadores: nada de URL, seletor,
  trecho de HTML, hash de IP ou detalhe de erro (PRD §9). O código de erro vira
  `{ code, message }` com a mensagem pronta (`RampaWeb.ErrorMessages`), como na API, mais o
  `http_status` da página quando houver (RF-RA029). `login_wall` não vai pelo canal: a tela
  o lê da API.
  """

  alias Rampa.Audits.Events.Event
  alias RampaWeb.ErrorMessages

  @doc "Resposta do join: o snapshot atual."
  @spec snapshot(Rampa.Audits.Events.snapshot()) :: map()
  def snapshot(%{revision: revision, progress: progress}),
    do: %{revision: revision, progress: progress(progress)}

  @doc "Recusa do join, no formato de erro da API."
  @spec error(atom()) :: map()
  def error(code), do: %{error: ErrorMessages.error(code)}

  @doc "Payload de um evento: `revision`, `progress` e os campos próprios do evento."
  @spec event(Event.t()) :: map()
  def event(%Event{} = event) do
    Map.merge(
      %{revision: event.revision, progress: progress(event.progress)},
      data(event.name, event.data)
    )
  end

  defp data(:status_changed, %{status: status}), do: %{status: status}

  defp data(:page_scanned, data),
    do: Map.take(data, [:page_id, :counts_by_severity, :needs_review_count])

  defp data(:page_failed, %{page_id: page_id, error: code} = data),
    do: %{page_id: page_id, error: ErrorMessages.page_error(code, data[:http_status])}

  defp data(:audit_completed, %{score: score}), do: %{score: score}
  defp data(:audit_failed, _data), do: %{}

  defp progress(progress) do
    progress
    |> Map.take([
      :status,
      :pages_found,
      :pages_scanned,
      :pages_failed,
      :totals_by_severity,
      :needs_review_count
    ])
    |> Map.put(
      :error,
      progress.error && ErrorMessages.page_error(progress.error, progress[:error_http_status])
    )
  end
end
