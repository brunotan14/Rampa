defmodule RampaWeb.AuditSocket do
  @moduledoc """
  Socket do tempo real em `/socket` (RF-RA004). Sem login: quem tem o id da auditoria (o link
  compartilhável, RF-RA014) acompanha o andamento dela. O único canal é `audit:<id>`
  (`RampaWeb.AuditChannel`).

  Proteções (PRD §9):

    * só websocket, sem longpoll, com `max_frame_size` pequeno: o cliente só manda join e
      heartbeat (`RampaWeb.Endpoint`);
    * `check_origin` em produção pela origem do app (`RampaWeb.Origins`);
    * no máximo `config :rampa, :audit_channel, max_per_connection` canais por conexão
      (`RampaWeb.AuditChannel`);
    * o limite de conexões por IP fica no Traefik, que conhece o IP real.

  O socket não tem `id`: não há usuário para desconectar.
  """

  use Phoenix.Socket

  channel "audit:*", RampaWeb.AuditChannel

  @impl Phoenix.Socket
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl Phoenix.Socket
  def id(_socket), do: nil
end
