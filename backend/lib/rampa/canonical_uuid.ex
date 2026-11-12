defmodule Rampa.CanonicalUUID do
  @moduledoc """
  UUID só na forma canônica: 36 caracteres, minúsculos, com hífens. O `Ecto.UUID.cast/1`
  aceita também a forma maiúscula, sem hífens não, mas aceita um binário de 16 bytes
  qualquer (`"aaaaaaaaaaaaaaaa"` vira um UUID): para ids que vêm de fora (caminho da API,
  `page_id`, âncora do cursor, tópico do canal), outro formato é recusado, como no join do
  canal `audit:<id>`.
  """

  @doc "`{:ok, id}` se `id` já é um UUID canônico; senão `:error`."
  @spec cast(term()) :: {:ok, Ecto.UUID.t()} | :error
  def cast(id) when is_binary(id) and byte_size(id) == 36 do
    case Ecto.UUID.cast(id) do
      {:ok, ^id} -> {:ok, id}
      _other -> :error
    end
  end

  def cast(_id), do: :error
end
