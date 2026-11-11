defmodule Rampa.Audits.RulesTest do
  use ExUnit.Case, async: true

  alias Rampa.Audits.Rules

  defp scan(status), do: %{kind: :scan, status: status}
  defp task(kind, status), do: %{kind: kind, status: status}

  describe "page_status/1" do
    test "scan pendente: queued" do
      assert Rules.page_status([scan(:pending)]) == :queued
    end

    test "scan rodando: scanning" do
      assert Rules.page_status([scan(:running)]) == :scanning
    end

    test "scan concluído sem outras tarefas: done" do
      assert Rules.page_status([scan(:done)]) == :done
    end

    test "scan concluído com análise pendente ou rodando: analyzing" do
      assert Rules.page_status([scan(:done), task(:alt_text, :pending)]) == :analyzing

      assert Rules.page_status([task(:links, :running), scan(:done), task(:focus, :done)]) ==
               :analyzing
    end

    test "todas as tarefas terminadas e o scan deu certo: done" do
      assert Rules.page_status([scan(:done), task(:alt_text, :done), task(:links, :done)]) ==
               :done
    end

    test "falha de tarefa que não é scan não falha a página" do
      assert Rules.page_status([scan(:done), task(:alt_text, :failed)]) == :done

      assert Rules.page_status([scan(:done), task(:alt_text, :failed), task(:links, :pending)]) ==
               :analyzing
    end

    test "scan falhou: failed, mesmo com outra tarefa aberta" do
      assert Rules.page_status([scan(:failed)]) == :failed
      assert Rules.page_status([scan(:failed), task(:alt_text, :pending)]) == :failed
    end

    test "aceita structs e a ordem das tarefas não importa" do
      tasks = [
        %Rampa.Audits.PageTask{kind: :headings, status: :pending},
        %Rampa.Audits.PageTask{kind: :scan, status: :done}
      ]

      assert Rules.page_status(tasks) == :analyzing
      assert Rules.page_status(Enum.reverse(tasks)) == :analyzing
    end

    test "página sem tarefa scan quebra a invariante" do
      assert_raise ArgumentError, fn -> Rules.page_status([task(:alt_text, :done)]) end
      assert_raise ArgumentError, fn -> Rules.page_status([]) end
    end
  end

  describe "audit_outcome/1" do
    test "aberta enquanto há tarefa pendente ou rodando" do
      assert Rules.audit_outcome(%{open_tasks: 1, pages_done: 0}) == :open
      assert Rules.audit_outcome(%{open_tasks: 3, pages_done: 5}) == :open
    end

    test "completed se ao menos uma página terminou done" do
      assert Rules.audit_outcome(%{open_tasks: 0, pages_done: 1}) == :completed
    end

    test "failed se nenhuma página terminou done" do
      assert Rules.audit_outcome(%{open_tasks: 0, pages_done: 0}) == :failed
    end
  end

  test "open?/1" do
    assert Rules.open?(%{status: :pending})
    assert Rules.open?(%{status: :running})
    refute Rules.open?(%{status: :done})
    refute Rules.open?(%{status: :failed})
  end
end
