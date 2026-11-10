defmodule Rampa.Audits.PageDataTest do
  use ExUnit.Case, async: true

  alias Rampa.Audits.PageData

  describe "sanitize/1" do
    test "remove NUL de strings, em mapas (chaves e valores) e listas, em qualquer profundidade" do
      data = %{
        "title" => "Tí\u0000tulo",
        "axe" => %{
          "violations" => [
            %{
              "id" => "image-alt",
              "tags" => ["wcag\u0000111"],
              "nodes" => [%{"target" => [["#ho\u0000st", "img"]], "html" => "<img\u0000>"}]
            }
          ]
        },
        "ch\u0000ave" => 1,
        "http_status" => 200,
        "vazio" => nil,
        "ok" => true
      }

      assert PageData.sanitize(data) == %{
               "title" => "Título",
               "axe" => %{
                 "violations" => [
                   %{
                     "id" => "image-alt",
                     "tags" => ["wcag111"],
                     "nodes" => [%{"target" => [["#host", "img"]], "html" => "<img>"}]
                   }
                 ]
               },
               "chave" => 1,
               "http_status" => 200,
               "vazio" => nil,
               "ok" => true
             }
    end

    test "string sem NUL fica igual" do
      assert PageData.sanitize("ação 😀") == "ação 😀"
    end
  end

  describe "truncate_bytes/2" do
    test "texto curto fica igual" do
      assert PageData.truncate_bytes("<p>olá</p>", 2048) == "<p>olá</p>"
      assert PageData.truncate_bytes(nil, 2048) == nil
    end

    test "não quebra caractere acentuado (2 bytes)" do
      # "a" + 1 024 × "é" (2 bytes cada) = 2 049 bytes; o último "é" não cabe inteiro.
      text = "a" <> String.duplicate("é", 1_024)
      result = PageData.truncate_bytes(text, 2048)

      assert String.valid?(result)
      assert byte_size(result) == 2047
      assert result == "a" <> String.duplicate("é", 1_023)
    end

    test "não quebra emoji (4 bytes)" do
      text = "ab" <> String.duplicate("😀", 600)

      for max <- 2046..2050 do
        result = PageData.truncate_bytes(text, max)
        assert String.valid?(result)
        assert byte_size(result) <= max
        assert byte_size(result) > max - 4
        assert String.starts_with?(text, result)
      end
    end
  end
end
