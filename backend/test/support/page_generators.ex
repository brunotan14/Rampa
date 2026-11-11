defmodule Rampa.PageGenerators do
  @moduledoc """
  Geradores (StreamData) do que vem da página auditada, para os testes por propriedade do
  saneamento e da conversão do resultado do axe (RNF-RA005, RF-RA003).
  """

  alias StreamData, as: SD

  @doc """
  Texto UTF-8 com NUL, acento combinante e caracteres de 1 a 4 bytes, às vezes longo
  (repetição de um pedaço, para passar dos limites sem gerar milhares de caracteres
  aleatórios).
  """
  def text do
    piece =
      SD.one_of([
        SD.string(:utf8, max_length: 20),
        SD.map(
          SD.list_of(SD.member_of(["\0", "a", "é", "€", "😀", "\u0301", " ", "<", "\""])),
          &Enum.join/1
        )
      ])

    SD.one_of([
      piece,
      SD.bind(piece, fn piece -> SD.map(SD.integer(0..400), &String.duplicate(piece, &1)) end)
    ])
  end
end
