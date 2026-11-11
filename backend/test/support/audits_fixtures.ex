defmodule Rampa.AuditsFixtures do
  @moduledoc """
  Dados de teste para auditorias, inseridos direto no banco.

  Só para testes: em produção a auditoria nasce em `Rampa.Audits.create_audit/3`
  (`POST /api/audits`), depois da validação de URL e da proteção contra SSRF, e a página em
  `Rampa.Audits.add_page/2`.
  """

  alias Rampa.Audits.{Audit, Finding, Page, PageTask}
  alias Rampa.Repo

  @scanner_fixtures Path.expand("fixtures/scanner", __DIR__)

  @doc "Auditoria; `completed` e `failed` ganham `finished_at`, que o banco exige."
  def audit_fixture(attrs \\ %{}) do
    attrs = Map.merge(%{start_url: "https://exemplo.com/"}, attrs)

    attrs =
      if attrs[:status] in [:completed, :failed],
        do: Map.put_new(attrs, :finished_at, now()),
        else: attrs

    Repo.insert!(struct!(Audit, attrs))
  end

  @doc """
  Página com a tarefa `scan` no estado equivalente ao da página (`queued` → `pending`,
  `scanning` → `running`, `analyzing`/`done` → `done`, `failed` → `failed`). Os campos que
  o banco exige em cada estado ganham valores padrão. `:task` sobrescreve campos da tarefa.
  """
  def page_fixture(attrs \\ %{}) do
    {audit, attrs} = Map.pop_lazy(attrs, :audit, fn -> audit_fixture() end)
    {task_attrs, attrs} = Map.pop(attrs, :task, %{})
    attrs = Map.merge(%{audit_id: audit.id, url: audit.start_url}, attrs)
    status = Map.get(attrs, :status, :queued)

    page = Repo.insert!(struct!(Page, Map.merge(page_defaults(status), attrs)))

    Repo.insert!(
      struct!(
        PageTask,
        Map.merge(
          %{page_id: page.id, audit_id: page.audit_id, kind: :scan},
          Map.merge(scan_task_defaults(status, page.error), task_attrs)
        )
      )
    )

    page
  end

  @doc "Tarefa extra de uma página (análise do M4), inserida direto."
  def task_fixture(%Page{} = page, attrs) do
    Repo.insert!(
      struct!(PageTask, Map.merge(%{page_id: page.id, audit_id: page.audit_id}, attrs))
    )
  end

  defp page_defaults(status) when status in [:analyzing, :done],
    do: %{scanned_at: now(), axe_version: "4.14.0", final_url: "https://exemplo.com/"}

  defp page_defaults(:failed), do: %{error: "timeout"}
  defp page_defaults(_open), do: %{}

  defp scan_task_defaults(:queued, _error), do: %{status: :pending}

  defp scan_task_defaults(:scanning, _error),
    do: %{status: :running, attempt: 1, started_at: now()}

  defp scan_task_defaults(:failed, error),
    do: %{status: :failed, attempt: 1, error: error, started_at: now(), finished_at: now()}

  defp scan_task_defaults(_scanned, _error),
    do: %{status: :done, attempt: 1, started_at: now(), finished_at: now()}

  @doc "Achado de uma página, inserido direto. Padrão: `image-alt` do axe, crítico, confirmado."
  def finding_fixture(%Page{} = page, attrs \\ %{}) do
    Repo.insert!(
      struct!(
        Finding,
        Map.merge(
          %{
            page_id: page.id,
            audit_id: page.audit_id,
            source: :axe,
            rule_id: "image-alt",
            wcag_criteria: ["1.1.1"],
            severity: :critical,
            needs_review: false,
            selector: "img",
            html_snippet: ~s(<img src="a.png">),
            message: "Imagens precisam de texto alternativo",
            raw: %{"segredo" => "não sai na API"},
            crop_path: "recortes/a.png"
          },
          attrs
        )
      )
    )
  end

  @doc """
  Resposta real do scanner para uma fixture (`img-sem-alt`, `limpa`, `contraste-incerto`),
  gerada rodando `POST /scan` contra `scanner/test/fixtures/<nome>.html`.
  """
  def scanner_response(name) do
    @scanner_fixtures |> Path.join("#{name}.json") |> File.read!() |> Jason.decode!()
  end

  defp now, do: DateTime.utc_now(:second)
end
