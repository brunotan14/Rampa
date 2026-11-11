defmodule RampaWeb.ChannelCase do
  @moduledoc """
  Testes de canal (`Phoenix.ChannelTest`) com o sandbox do banco. O processo do canal herda o
  acesso ao banco do teste (`$callers`). Importa `RampaWeb.ChannelContract`, para validar
  cada payload contra `shared/channel-events.schema.json`.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import RampaWeb.ChannelCase
      import RampaWeb.ChannelContract

      @endpoint RampaWeb.Endpoint
    end
  end

  setup tags do
    Rampa.DataCase.setup_sandbox(tags)
    :ok
  end
end
