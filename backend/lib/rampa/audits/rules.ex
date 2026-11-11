defmodule Rampa.Audits.Rules do
  @moduledoc """
  Regras puras do ciclo de vida da auditoria: o estado da
  página a partir das tarefas e o desfecho da auditoria a partir das tarefas e páginas.
  Sem banco: `Rampa.Audits` lê as linhas travadas e grava o que estas funções decidem.
  """

  alias Rampa.Audits.Page

  @type task :: %{
          required(:kind) => atom(),
          required(:status) => atom(),
          optional(any()) => any()
        }
  @type outcome :: :open | :completed | :failed

  @open_task_statuses [:pending, :running]
  @final_page_statuses [:done, :failed]

  @doc """
  Estado da página. Depende do `scan`, porque as análises dependem dos dados dele:

    * `scan` `pending` → `:queued`; `running` → `:scanning`; `failed` → `:failed`;
    * `scan` `done` → `:analyzing` se outra tarefa está `pending` ou `running`, senão
      `:done`. Falha de outra tarefa não falha a página.

  Toda página tem uma tarefa `scan`; sem ela, levanta `ArgumentError`.
  """
  @spec page_status([task()]) :: Page.status()
  def page_status(tasks) when is_list(tasks) do
    case Enum.find(tasks, &(&1.kind == :scan)) do
      nil -> raise ArgumentError, "página sem tarefa scan"
      %{status: :pending} -> :queued
      %{status: :running} -> :scanning
      %{status: :failed} -> :failed
      %{status: :done} -> if Enum.any?(tasks, &open?/1), do: :analyzing, else: :done
    end
  end

  @doc """
  Desfecho da auditoria: `:open` enquanto há tarefa `pending` ou `running` em alguma página;
  depois, `:completed` se ao menos uma página terminou `done`, senão `:failed`.
  """
  @spec audit_outcome(%{open_tasks: non_neg_integer(), pages_done: non_neg_integer()}) ::
          outcome()
  def audit_outcome(%{open_tasks: open, pages_done: _done}) when open > 0, do: :open
  def audit_outcome(%{open_tasks: 0, pages_done: done}) when done > 0, do: :completed
  def audit_outcome(%{open_tasks: 0, pages_done: 0}), do: :failed

  @doc "Estados de tarefa que ainda não terminou. A única definição do projeto."
  @spec open_statuses() :: [:pending | :running]
  def open_statuses, do: @open_task_statuses

  @doc "Tarefa ainda não terminou."
  @spec open?(task()) :: boolean()
  def open?(%{status: status}), do: status in @open_task_statuses

  @doc "Estados de página encerrada: não ganha tarefa nova."
  @spec final_page_statuses() :: [Page.status()]
  def final_page_statuses, do: @final_page_statuses

  @doc "Página encerrada."
  @spec page_finished?(Page.t() | %{status: Page.status()}) :: boolean()
  def page_finished?(%{status: status}), do: status in @final_page_statuses
end
