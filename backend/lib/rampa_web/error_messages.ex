defmodule RampaWeb.ErrorMessages do
  @moduledoc """
  Todas as mensagens de erro que a API mostra (PRD §9: `{ "error": { "code", "message" } }`,
  com `message` em português do Brasil pronta para exibir). Controllers e views só passam o
  código; o texto mora aqui.

  Os textos passam pelo Gettext (domínio `errors`, `RampaWeb.Gettext`), com o português como
  idioma de origem (`default_locale: "pt_BR"`): para outro idioma basta um `errors.po` novo
  em `priv/gettext/<idioma>/`, sem mexer no código (RNF-RA009). `mix gettext.extract` lista
  as mensagens em `priv/gettext/errors.pot`.

  Os códigos vêm de `Rampa.ErrorCodes`, a fonte única; o teste de contrato falha se algum
  deles não tiver mensagem própria aqui.

  Os códigos dos erros de página e de auditoria (`pages.error`, `audits.error`) também
  ganham mensagem aqui, para `GET /api/audits/:id` devolver o erro já pronto para a tela.
  """

  use Gettext, backend: RampaWeb.Gettext

  alias Rampa.Audits.Limits

  @type error :: %{code: String.t(), message: String.t()}

  @doc "Erro no formato da API: `%{code, message}`."
  @spec error(atom() | String.t(), keyword()) :: error()
  def error(code, bindings \\ []) do
    code = to_string(code)
    %{code: code, message: message(code, bindings)}
  end

  @doc """
  Mensagem do código. `rate_limited` recebe `:retry_at` (`DateTime`); o horário sai no fuso
  de São Paulo, `HH:MM`.
  """
  @spec message(atom() | String.t(), keyword()) :: String.t()
  def message(code, bindings \\ [])

  def message(code, bindings) when is_atom(code), do: message(Atom.to_string(code), bindings)

  ## Criação da auditoria (RF-RA001, RF-RA002)

  def message("unsupported_scheme", _bindings),
    do: dgettext("errors", "Só endereços web (http:// ou https://) podem ser auditados.")

  def message("invalid_url", _bindings) do
    dgettext(
      "errors",
      "Este endereço não é válido. Confira se ele está completo, sem usuário e senha, " <>
        "e com até 2.048 caracteres."
    )
  end

  def message("blocked_address", _bindings) do
    dgettext(
      "errors",
      "Este endereço não pode ser auditado. O Rampa só acessa sites públicos, nas portas " <>
        "80 e 443."
    )
  end

  def message("unresolvable", _bindings),
    do: dgettext("errors", "Não encontramos este domínio. Confira se o endereço está certo.")

  def message("dns_error", _bindings) do
    dgettext(
      "errors",
      "Não foi possível verificar este endereço agora. Tente de novo em alguns instantes."
    )
  end

  def message("invalid_page_limit", _bindings),
    do: dgettext("errors", "O limite de páginas precisa ser um número inteiro de 1 a 25.")

  def message("invalid_idempotency_key", _bindings) do
    dgettext(
      "errors",
      "O cabeçalho Idempotency-Key precisa ter de 1 a 128 caracteres, sem espaços nem acentos."
    )
  end

  def message("idempotency_conflict", _bindings) do
    dgettext(
      "errors",
      "Outra requisição com o mesmo Idempotency-Key está em andamento. Tente de novo."
    )
  end

  def message("idempotency_key_reused", _bindings) do
    dgettext(
      "errors",
      "Este Idempotency-Key já foi usado para auditar outro endereço. Use uma chave nova " <>
        "para cada auditoria."
    )
  end

  def message("invalid_body", _bindings) do
    dgettext(
      "errors",
      "Envie um JSON com o campo url, com o endereço a auditar."
    )
  end

  def message("rate_limited", bindings) do
    time = bindings |> Keyword.fetch!(:retry_at) |> Limits.local_time()

    dgettext(
      "errors",
      "Você atingiu o limite de auditorias por hora. Tente de novo a partir das %{time}.",
      time: time
    )
  end

  def message("daily_limit_reached", _bindings) do
    dgettext(
      "errors",
      "O limite de auditorias de hoje acabou. Tente de novo amanhã."
    )
  end

  ## Consulta

  def message("audit_not_found", _bindings),
    do: dgettext("errors", "Auditoria não encontrada. Confira o endereço do relatório.")

  def message("page_not_found", _bindings),
    do: dgettext("errors", "Esta página não faz parte da auditoria. Volte à lista de páginas.")

  def message("finding_not_found", _bindings) do
    dgettext(
      "errors",
      "Este problema não faz parte da auditoria. Volte à lista de problemas."
    )
  end

  def message("invalid_filter", _bindings) do
    dgettext(
      "errors",
      "Filtro inválido. Use severity (critical, serious, moderate ou minor), source (axe, ai " <>
        "ou heuristic), needs_review (true ou false), page_id (id de uma página) e wcag " <>
        "(critério no formato 1.4.3)."
    )
  end

  def message("invalid_sort", _bindings),
    do: dgettext("errors", "Ordem inválida. Use sort=recorded ou sort=severity.")

  def message("invalid_limit", _bindings),
    do: dgettext("errors", "O parâmetro limit precisa ser um número inteiro de 1 a 100.")

  def message("invalid_cursor", _bindings) do
    dgettext(
      "errors",
      "O cursor da paginação não é válido. Recomece a lista do início."
    )
  end

  ## Canal `audit:<id>` (RF-RA004)

  def message("channel_limit_reached", _bindings) do
    dgettext(
      "errors",
      "Esta conexão já acompanha auditorias demais ao mesmo tempo. Feche outras abas do " <>
        "Rampa e recarregue a página."
    )
  end

  ## Erros genéricos de HTTP

  def message("bad_request", _bindings),
    do: dgettext("errors", "A requisição está malformada.")

  def message("not_found", _bindings),
    do: dgettext("errors", "Este endereço da API não existe.")

  def message("method_not_allowed", _bindings),
    do: dgettext("errors", "Este método não é aceito neste endereço da API.")

  def message("not_acceptable", _bindings),
    do: dgettext("errors", "A API só responde em JSON.")

  def message("payload_too_large", _bindings),
    do: dgettext("errors", "O corpo da requisição é grande demais.")

  def message("unsupported_media_type", _bindings),
    do: dgettext("errors", "Envie o corpo da requisição em JSON.")

  ## Erros de página e de auditoria (`pages.error`, `audits.error`)

  def message("timeout", _bindings) do
    dgettext(
      "errors",
      "A página demorou demais para carregar ou para ser analisada."
    )
  end

  def message("http_error", _bindings) do
    dgettext(
      "errors",
      "A página respondeu com um erro HTTP e não foi analisada."
    )
  end

  def message("navigation_failed", _bindings),
    do: dgettext("errors", "Não foi possível abrir a página.")

  def message("analysis_failed", _bindings),
    do: dgettext("errors", "A página abriu, mas a análise falhou.")

  def message("resource_limit", _bindings) do
    dgettext(
      "errors",
      "A página passou do limite de dados ou de conexões da análise."
    )
  end

  def message("unavailable", _bindings) do
    dgettext(
      "errors",
      "O serviço de análise estava indisponível. Tente uma nova auditoria em alguns minutos."
    )
  end

  def message("invalid_request", _bindings),
    do: dgettext("errors", "O serviço de análise recusou esta página.")

  def message("invalid_scan_result", _bindings),
    do: dgettext("errors", "O resultado da análise veio incompleto.")

  def message("contract_mismatch", _bindings) do
    dgettext(
      "errors",
      "Não foi possível concluir a análise por uma incompatibilidade interna do Rampa. O problema ficou registrado para a equipe corrigir."
    )
  end

  def message("stale", _bindings) do
    dgettext(
      "errors",
      "A análise ficou parada por tempo demais e foi encerrada."
    )
  end

  def message("scan_failed", _bindings) do
    dgettext(
      "errors",
      "A varredura da página falhou, então as análises que dependem dela não rodaram."
    )
  end

  def message(_internal_error_or_unknown, _bindings) do
    dgettext(
      "errors",
      "Ocorreu um erro inesperado. Tente de novo em alguns instantes."
    )
  end
end
