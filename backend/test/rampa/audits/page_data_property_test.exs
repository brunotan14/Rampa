defmodule Rampa.Audits.PageDataPropertyTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  import Rampa.PageGenerators, only: [text: 0]

  alias Rampa.Audits.PageData
  alias StreamData, as: SD

  # RNF-RA005: o que vem da página auditada é limpo antes de gravar. Os exemplos fixos ficam
  # em `page_data_test.exs`.

  # Estrutura como a resposta do scanner: mapas com chave em texto, listas e folhas de
  # qualquer tipo do JSON, com NUL nas chaves e nos valores.
  defp json_like do
    leaf =
      SD.one_of([
        text(),
        SD.integer(),
        SD.float(),
        SD.boolean(),
        SD.constant(nil)
      ])

    SD.tree(leaf, fn child ->
      SD.one_of([
        SD.list_of(child, max_length: 5),
        SD.map_of(text(), child, max_length: 5)
      ])
    end)
  end

  defp strings(data) when is_binary(data), do: [data]
  defp strings(data) when is_list(data), do: Enum.flat_map(data, &strings/1)

  defp strings(data) when is_map(data),
    do: Enum.flat_map(data, fn {key, value} -> strings(key) ++ strings(value) end)

  defp strings(_data), do: []

  describe "truncate_bytes/2" do
    property "nunca passa do limite, é UTF-8 válido e é prefixo do original" do
      check all text <- text(), max <- SD.integer(0..3_000), max_runs: 500 do
        result = PageData.truncate_bytes(text, max)

        assert byte_size(result) <= max
        assert String.valid?(result)
        assert String.starts_with?(text, result)
      end
    end

    property "só tira o caractere cortado: perde no máximo 3 bytes além do limite" do
      check all text <- text(), max <- SD.integer(0..3_000), max_runs: 300 do
        result = PageData.truncate_bytes(text, max)

        if byte_size(text) <= max,
          do: assert(result == text),
          else: assert(byte_size(result) >= max - 3)
      end
    end
  end

  describe "sanitize/1" do
    property "não sobra NUL em nenhuma string, em qualquer profundidade" do
      check all data <- json_like(), max_runs: 300 do
        sanitized = PageData.sanitize(data)

        for string <- strings(sanitized), do: refute(String.contains?(string, <<0>>))
      end
    end

    property "só tira o NUL: o resto do texto fica igual" do
      check all text <- text(), max_runs: 300 do
        assert PageData.sanitize(text) ==
                 for(<<c::utf8 <- text>>, c != 0, into: "", do: <<c::utf8>>)
      end
    end

    property "é idempotente e mantém o que não é texto" do
      check all data <- json_like(), max_runs: 200 do
        sanitized = PageData.sanitize(data)

        assert PageData.sanitize(sanitized) == sanitized

        if not is_binary(data) and not is_list(data) and not is_map(data),
          do: assert(sanitized === data)
      end
    end
  end
end
