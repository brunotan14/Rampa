defmodule Rampa.Audits.LoginWall do
  @moduledoc """
  Decide se uma página pede login (RF-RA028), a partir dos fatos que o scanner informa. O
  scanner só coleta (`login_wall.password_field`, `final_url` e o status HTTP); a decisão é
  daqui, numa função pura.

  Precisão antes de cobertura (CLAUDE.md, "Achados de IA são sugestões"): o aviso diz que o
  Rampa não auditou o sistema inteiro, e um aviso falso numa página aberta custa confiança.

    * status 401 → `true`, com ou sem os outros fatos (a página de erro não é varrida);
    * status 403 → não decide nada sozinho: num site público costuma ser bloqueio de robô
      (WAF), não login. Fica `nil` (a mensagem do `http_error` explica as duas hipóteses);
    * campo de senha visível **e** `final_url` em outro caminho ou outra origem que a URL
      pedida **e** um termo de login no caminho ou no host da `final_url` → `true` (o caso
      típico: `/painel` redireciona para `/entrar.html`, ou para `sso.exemplo.gov.br`);
    * campo de senha visível com redirecionamento para endereço sem termo de login → `false`:
      `banco.com.br/` → `www.banco.com.br/pt/` com a caixa de internet banking é uma home
      comum;
    * campo de senha visível sem redirecionamento → `false`: um formulário de login no
      cabeçalho de uma página comum não é barreira. O caso perdido (tela de login de uma SPA
      que não muda de endereço) está registrado no PRD §15;
    * redirecionamento sem campo de senha → `false`: `http` → `https`, barra final,
      `/` → `/pt-br/` são comuns e não pedem login;
    * fato que falta (`password_field` ou `final_url` ausentes, sem 401) → `nil`, "não
      sabido".

  A comparação de URLs é mínima: `http` e `https` valem o mesmo, o host em minúsculas, a
  porta padrão de cada esquema é ignorada e a barra final do caminho também. A consulta e o
  fragmento não contam.

  Termos de login (`login_terms/0`), sem diferenciar maiúsculas, comparados por segmento do
  caminho e por rótulo do host, nunca como pedaço de palavra: o segmento ou rótulo inteiro, ou
  uma das partes dele separadas por `.`, `-` ou `_` (`entrar.html`, `acesso-restrito`,
  `sign-in`). `/contato` e `/blogin` não contam.
  """

  @login_status 401

  @login_terms ~w(login logon signin sign-in entrar acesso auth sso conta account session sessao)

  @type facts :: %{
          optional(:requested_url) => String.t() | nil,
          optional(:final_url) => String.t() | nil,
          optional(:http_status) => integer() | nil,
          optional(:password_field) => boolean() | nil
        }

  @doc "Termos que, no caminho ou no host da `final_url`, indicam uma tela de login."
  @spec login_terms() :: [String.t()]
  def login_terms, do: @login_terms

  @doc "`true` se a página pede login, `false` se não, `nil` se os fatos não bastam."
  @spec decide(facts()) :: boolean() | nil
  def decide(%{http_status: @login_status}), do: true

  def decide(%{password_field: false}), do: false

  def decide(%{password_field: true} = facts) do
    case {location(facts[:requested_url]), location(facts[:final_url])} do
      {nil, _final} -> nil
      {_requested, nil} -> nil
      {same, same} -> false
      {_requested, final} -> login_location?(final)
    end
  end

  def decide(_facts), do: nil

  # Host (minúsculas), porta (`nil` quando é a padrão do esquema) e caminho sem a barra
  # final. Esquema fora de http/https ou URL sem host: `nil`.
  defp location(url) when is_binary(url) do
    case URI.parse(url) do
      %URI{scheme: scheme, host: host} = uri
      when scheme in ["http", "https"] and is_binary(host) and host != "" ->
        {String.downcase(host), port(uri), path(uri.path)}

      _other ->
        nil
    end
  end

  defp location(_missing), do: nil

  # Algum rótulo do host ou segmento do caminho é (ou tem como parte) um termo de login.
  defp login_location?({host, _port, path}) do
    labels = String.split(host, ".")
    segments = path |> String.split("/", trim: true) |> Enum.map(&decode/1)
    Enum.any?(labels ++ segments, &login_token?/1)
  end

  defp login_token?(token) do
    token = String.downcase(token)
    parts = String.split(token, [".", "-", "_"], trim: true)
    Enum.any?([token | parts], &(&1 in @login_terms))
  end

  defp decode(segment) do
    URI.decode(segment)
  rescue
    ArgumentError -> segment
  end

  defp port(%URI{scheme: "http", port: 80}), do: nil
  defp port(%URI{scheme: "https", port: 443}), do: nil
  defp port(%URI{port: port}), do: port

  defp path(nil), do: ""
  defp path(path), do: String.trim_trailing(path, "/")
end
