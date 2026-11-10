defmodule Rampa.Audits.PageData do
  @moduledoc """
  Saneamento do que vem da página auditada, antes de gravar (RNF-RA005).

  Tudo que o scanner devolve nasce na página de um terceiro: título, URL final, trechos de
  HTML, seletores e as mensagens do axe que citam o conteúdo. Este é o ponto único em que
  esses dados são limpos:

    * `sanitize/1` remove o caractere NUL (U+0000) de toda string, recursivamente em mapas
      (chaves e valores) e listas. O PostgreSQL recusa NUL em `text` e em `jsonb`, então
      uma página com NUL derrubaria a gravação;
    * `truncate_bytes/2` corta um texto em bytes sem deixar caractere UTF-8 pela metade.
  """

  @nul <<0>>

  @doc "Remove o NUL de todas as strings de `data`, em qualquer profundidade."
  @spec sanitize(term()) :: term()
  def sanitize(data) when is_binary(data), do: String.replace(data, @nul, "")
  def sanitize(data) when is_list(data), do: Enum.map(data, &sanitize/1)

  def sanitize(data) when is_map(data) and not is_struct(data),
    do: Map.new(data, fn {key, value} -> {sanitize(key), sanitize(value)} end)

  def sanitize(data), do: data

  @doc """
  Corta `text` em no máximo `max_bytes` bytes sem deixar um caractere UTF-8 pela metade.
  """
  @spec truncate_bytes(String.t() | nil, non_neg_integer()) :: String.t() | nil
  def truncate_bytes(nil, _max_bytes), do: nil

  def truncate_bytes(text, max_bytes) when byte_size(text) <= max_bytes, do: text

  def truncate_bytes(text, max_bytes) do
    # O corte pode deixar o último caractere pela metade (até 3 bytes soltos); a sequência
    # incompleta é inválida e sai inteira. Nunca aumenta o tamanho.
    text
    |> binary_part(0, max_bytes)
    |> String.replace_invalid("")
  end
end
