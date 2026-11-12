defmodule RampaWeb.AuditChannel do
  @moduledoc """
  Canal `audit:<id>`: o andamento de uma auditoria em tempo real (RF-RA004, PRD §9). Contrato
  em `shared/channel-events.schema.json`; o JSON sai de `RampaWeb.AuditChannelJSON`.

  ## Join

  O `id` precisa ser um UUID canônico, em minúsculas (é o que `POST /api/audits` devolve e o
  tópico em que os eventos saem), e a auditoria precisa existir. Fora disso, a recusa é
  `audit_not_found`, igual para os dois casos. Auditoria já encerrada aceita join: o snapshot
  já é o estado final, e nenhum evento chega depois. Os parâmetros do join são ignorados.

  Ordem: id canônico (sem banco), limite por conexão, inscrição e snapshot. Para não perder
  evento entre o snapshot e a inscrição, o canal se inscreve **antes**
  no tópico interno da auditoria (`Rampa.Audits.Events.topic/1`) e só então lê o snapshot
  (`Rampa.Audits.get_progress/1`), que volta na resposta do join (`revision` e `progress`). O
  join roda no próprio processo do canal: os eventos publicados depois da inscrição ficam na
  caixa de mensagens e são tratados depois do join.

  Depois da leitura do snapshot, o canal emite `[:rampa, :audit_channel, :snapshot]`
  (medida `revision`, metadado `audit_id`), no próprio processo do canal.

  ## Eventos

  Um evento com `revision` menor ou igual à do snapshot já está refletido nele e não é
  enviado. Os outros saem todos, **na ordem de chegada**, mesmo fora da ordem da `revision`:
  a referência é só a `revision` do snapshot, fixa depois do join, nunca a do último evento
  enviado (o N+2 pode chegar antes do N+1, e os dois têm de sair). Quem ordena é o cliente,
  pelo `progress` de maior `revision`.

  ## Limite por conexão

  No máximo `config :rampa, :audit_channel, max_per_connection` canais por conexão
  (`channel_limit_reached`), contados num `Registry` com a chave do processo do transporte. A
  contagem é aproximada: dois joins simultâneos na mesma conexão podem passar um a mais.
  """

  use RampaWeb, :channel

  alias Rampa.Audits
  alias Rampa.Audits.Events
  alias Rampa.Audits.Events.Event
  alias RampaWeb.AuditChannelJSON

  @registry RampaWeb.AuditChannel.Registry

  @impl Phoenix.Channel
  def join("audit:" <> id, _params, socket) do
    with {:ok, audit_id} <- canonical_id(id),
         :ok <- check_limit(socket),
         :ok <- Events.subscribe(audit_id),
         {:ok, snapshot} <- snapshot(audit_id, socket) do
      :telemetry.execute(
        [:rampa, :audit_channel, :snapshot],
        %{revision: snapshot.revision},
        %{audit_id: audit_id}
      )

      {:ok, AuditChannelJSON.snapshot(snapshot),
       assign(socket, audit_id: audit_id, revision: snapshot.revision)}
    else
      {:error, code} when code in [:audit_not_found, :channel_limit_reached] ->
        {:error, AuditChannelJSON.error(code)}
    end
  end

  @impl Phoenix.Channel
  def handle_info({:audit_event, %Event{revision: revision}}, socket)
      when revision <= socket.assigns.revision,
      do: {:noreply, socket}

  def handle_info({:audit_event, %Event{} = event}, socket) do
    push(socket, Atom.to_string(event.name), AuditChannelJSON.event(event))
    {:noreply, socket}
  end

  # O cliente não manda eventos neste canal: o que chegar é ignorado.
  @impl Phoenix.Channel
  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  # Só o UUID canônico (minúsculo, com hífens): outro formato entraria num tópico em que
  # nenhum evento sai. Recusado sem consultar o banco.
  defp canonical_id(id) do
    case Rampa.CanonicalUUID.cast(id) do
      {:ok, id} -> {:ok, id}
      :error -> {:error, :audit_not_found}
    end
  end

  # Auditoria inexistente: a vaga é devolvida antes da recusa, sem esperar o `Registry`
  # limpar a entrada do processo que vai terminar.
  defp snapshot(audit_id, socket) do
    case Audits.get_progress(audit_id) do
      {:ok, snapshot} ->
        {:ok, snapshot}

      {:error, :audit_not_found} = error ->
        :ok = Registry.unregister(@registry, socket.transport_pid)
        error
    end
  end

  defp check_limit(socket) do
    max = Application.fetch_env!(:rampa, :audit_channel)[:max_per_connection]

    if Registry.count_match(@registry, socket.transport_pid, :_) >= max do
      {:error, :channel_limit_reached}
    else
      {:ok, _owner} = Registry.register(@registry, socket.transport_pid, nil)
      :ok
    end
  end
end
