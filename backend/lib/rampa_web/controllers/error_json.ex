defmodule RampaWeb.ErrorJSON do
  @moduledoc """
  Corpo de erro da API, sempre `{ "error": { "code", "message" } }` com a mensagem em
  português (PRD §9; textos em `RampaWeb.ErrorMessages`).

  `render/2` é chamado pelo Phoenix para os erros que não passam por um controller (rota
  inexistente, JSON malformado, exceção): o código sai do status HTTP. `error/2` é usado
  pelo `RampaWeb.FallbackController` para os erros do domínio.
  """

  alias RampaWeb.ErrorMessages

  @doc "Erro do domínio: `%{error: %{code, message}}`, com campos extras opcionais."
  @spec error(atom() | String.t(), keyword(), map()) :: %{error: map()}
  def error(code, bindings \\ [], extra \\ %{}) do
    %{error: Map.merge(ErrorMessages.error(code, bindings), extra)}
  end

  def render(template, assigns) do
    template
    |> String.split(".")
    |> hd()
    |> String.to_integer()
    |> status_code(assigns[:reason])
    |> error()
  end

  # JSON malformado no corpo (`Plug.Parsers`).
  defp status_code(400, %Plug.Parsers.ParseError{}), do: :invalid_body
  defp status_code(400, _reason), do: :bad_request
  defp status_code(404, _reason), do: :not_found
  defp status_code(405, _reason), do: :method_not_allowed
  defp status_code(406, _reason), do: :not_acceptable
  defp status_code(413, _reason), do: :payload_too_large
  defp status_code(415, _reason), do: :unsupported_media_type
  defp status_code(status, _reason) when status in 400..499, do: :bad_request
  defp status_code(_status, _reason), do: :internal_error
end
