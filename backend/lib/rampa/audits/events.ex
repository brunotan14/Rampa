defmodule Rampa.Audits.Events do
  @moduledoc """
  Eventos de andamento de uma auditoria (RF-RA004, PRD §9), em dados de domínio. Quem os
  transforma em JSON para o canal `audit:<id>` é `RampaWeb.AuditChannelJSON`.

  ## De onde vêm

  Os eventos são **derivados do diff de estado** (`diff/4`), não da função que mudou o estado:
  `Rampa.Audits` chama `diff/4` no ponto único de escrita da auditoria (`commit_progress`),
  com a auditoria e a página de antes e de depois da transição. Assim a falha de uma análise
  (M4), que termina a página `done`, não vira `page_failed`.

  Todo evento leva a `revision` e o `progress` **absolutos** da auditoria, lidos na mesma
  transação, com a auditoria travada. Eventos da mesma transação compartilham a `revision`.

  ## Quando saem

  `publish/1` só roda **fora de transação** (levanta `ArgumentError` dentro de uma): os
  eventos saem depois do commit, nunca de uma transação que ainda pode ser desfeita. Falha ao
  publicar só vai para o log: o estado já foi gravado, e o cliente se recupera pelo snapshot do
  join ou pelo `GET /api/audits/:id` (PRD §9).

  As mensagens vão para o tópico interno `topic/1` (`audit_events:<id>`), diferente do tópico
  do canal: o canal se inscreve nele **antes** de ler o snapshot (`RampaWeb.AuditChannel`).
  """

  require Logger

  alias Rampa.Audits.{Audit, Page}
  alias Rampa.Repo

  @type name :: :status_changed | :page_scanned | :page_failed | :audit_completed | :audit_failed

  @type progress :: %{
          status: Audit.status(),
          pages_found: non_neg_integer(),
          pages_scanned: non_neg_integer(),
          pages_failed: non_neg_integer(),
          totals_by_severity: %{atom() => non_neg_integer()},
          needs_review_count: non_neg_integer(),
          error: String.t() | nil
        }

  @type snapshot :: %{revision: non_neg_integer(), progress: progress()}

  @type change :: {name(), map()}

  defmodule Event do
    @moduledoc "Um evento de andamento, com o estado absoluto da auditoria."

    @enforce_keys [:name, :audit_id, :revision, :progress]
    defstruct [:name, :audit_id, :revision, :progress, data: %{}]

    @type t :: %__MODULE__{
            name: Rampa.Audits.Events.name(),
            audit_id: Ecto.UUID.t(),
            revision: non_neg_integer(),
            progress: Rampa.Audits.Events.progress(),
            data: map()
          }
  end

  @names [:status_changed, :page_scanned, :page_failed, :audit_completed, :audit_failed]

  @scanned_page_statuses [:analyzing, :done]
  @unscanned_page_statuses [:queued, :scanning]

  @doc "Nomes dos eventos que `diff/4` produz (os de `x-events` no contrato do canal)."
  @spec names() :: [name()]
  def names, do: @names

  @doc "Tópico interno do PubSub com os eventos da auditoria."
  @spec topic(Ecto.UUID.t()) :: String.t()
  def topic(audit_id), do: "audit_events:" <> audit_id

  @doc """
  Inscreve o processo atual nos eventos da auditoria. Cada evento chega como
  `{:audit_event, %Rampa.Audits.Events.Event{}}`.
  """
  @spec subscribe(Ecto.UUID.t()) :: :ok | {:error, term()}
  def subscribe(audit_id), do: Phoenix.PubSub.subscribe(pubsub(), topic(audit_id))

  @doc """
  Eventos de uma transição, a partir do estado de antes e de depois. Função pura.

    * `status_changed`: a auditoria passa de `queued` a `running`;
    * `page_scanned`: a página sai de `queued` ou `scanning` para `analyzing` ou `done`;
    * `page_failed`: a página passa a `failed`;
    * `audit_completed` ou `audit_failed`: a auditoria entra em `completed` ou `failed`.

  As páginas são `nil` quando a transição não mexe numa página. A ordem é a da lista acima.
  `page_scanned` sai só com o `page_id`; quem chama acrescenta as contagens da página.
  """
  @spec diff(Audit.t(), Audit.t(), Page.t() | nil, Page.t() | nil) :: [change()]
  def diff(%Audit{} = audit_before, %Audit{} = audit_after, page_before, page_after) do
    status_changes(audit_before, audit_after) ++
      page_changes(page_before, page_after) ++
      final_changes(audit_before, audit_after)
  end

  defp status_changes(%Audit{status: :queued}, %Audit{status: :running}),
    do: [{:status_changed, %{status: :running}}]

  defp status_changes(_before, _after), do: []

  defp page_changes(%Page{id: id, status: before}, %Page{id: id, status: now} = page) do
    cond do
      before in @unscanned_page_statuses and now in @scanned_page_statuses ->
        [{:page_scanned, %{page_id: id}}]

      before != :failed and now == :failed ->
        [{:page_failed, %{page_id: id, error: page.error}}]

      true ->
        []
    end
  end

  defp page_changes(_before, _after), do: []

  defp final_changes(%Audit{status: before}, %Audit{status: now} = audit) do
    finished? = before in Audit.final_statuses()

    case {finished?, now} do
      {false, :completed} -> [{:audit_completed, %{score: audit.score}}]
      {false, :failed} -> [{:audit_failed, %{}}]
      _other -> []
    end
  end

  @doc """
  Publica os eventos, na ordem, depois do commit. Levanta `ArgumentError` se chamada dentro
  de uma transação. Falha do PubSub não volta para quem chamou: fica no log (sem o conteúdo do
  evento) e a função devolve `:ok`.
  """
  @spec publish([Event.t()]) :: :ok
  def publish(events) when is_list(events) do
    if Repo.in_transaction?() do
      raise ArgumentError,
            "Rampa.Audits.Events.publish/1 chamada dentro de uma transação: os eventos só " <>
              "podem sair depois do commit"
    end

    Enum.each(events, &broadcast/1)
  end

  defp broadcast(%Event{} = event) do
    case Phoenix.PubSub.broadcast(pubsub(), topic(event.audit_id), {:audit_event, event}) do
      :ok -> :ok
      {:error, reason} -> log_failure(event, reason)
    end
  rescue
    exception -> log_failure(event, Exception.message(exception))
  catch
    kind, reason -> log_failure(event, {kind, reason})
  end

  defp log_failure(event, reason) do
    Logger.error(
      "eventos: falha ao publicar #{event.name} (revision #{event.revision}) da auditoria " <>
        "#{event.audit_id}: #{inspect(reason)}"
    )
  end

  defp pubsub, do: Application.get_env(:rampa, :audit_events_pubsub, Rampa.PubSub)
end
