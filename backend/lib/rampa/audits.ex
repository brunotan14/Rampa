defmodule Rampa.Audits do
  @moduledoc """
  Auditorias, páginas e achados (PRD §8).

  Este módulo ainda não cria auditorias: elas só podem nascer em `POST /api/audits`, depois
  da validação de URL e da proteção contra SSRF (RF-RA001, RF-RA002). Aqui ficam as
  transições usadas pelo `Rampa.Audits.ScanPageJob` (RF-RA003).

  Toda transição trava a página e depois a auditoria (`FOR UPDATE`, sempre nessa ordem) e
  confere o estado dentro da transação: página `done`/`failed` ou auditoria `completed`,
  `failed` ou `cancelled` não muda mais, e a função devolve `{:error, :already_finished}`.
  """

  import Ecto.Query

  alias Rampa.Audits.{Audit, AxeMapper, Finding, Page, PageData}
  alias Rampa.Repo

  # Limite de parâmetros do PostgreSQL (65 535) dividido pelas colunas de `findings`, com folga.
  @insert_chunk_size 1_000

  # O título vem da página: guardar só o necessário para identificá-la.
  @title_max_bytes 512

  @pending_page_statuses [:queued, :scanning, :analyzing]
  @final_page_statuses [:done, :failed]
  @final_audit_statuses [:completed, :failed, :cancelled]

  @type transition_error :: :page_not_found | :already_finished

  @doc "Marca a página `scanning` e a auditoria `running` (com `started_at`, se ainda nulo)."
  @spec start_page_scan(Ecto.UUID.t()) ::
          {:ok, Page.t()} | {:error, transition_error() | Ecto.Changeset.t()}
  def start_page_scan(page_id) do
    Repo.transact(fn ->
      with {:ok, page, audit} <- lock_pending(page_id),
           {:ok, page} <-
             Repo.update(Page.status_changeset(page, %{status: :scanning, error: nil})),
           {:ok, _audit} <-
             Repo.update(
               Audit.progress_changeset(audit, %{
                 status: :running,
                 started_at: audit.started_at || now()
               })
             ) do
        {:ok, page}
      end
    end)
  end

  @doc """
  Grava o resultado do scanner: os fatos da página e um achado por nó do axe.

  O resultado é saneado antes (`Rampa.Audits.PageData`): sem NUL e com o título cortado em
  #{@title_max_bytes} bytes. Resultado sem o campo `axe` devolve
  `{:error, :invalid_scan_result}`; achado que não passa no changeset devolve
  `{:error, changeset}` e nada é gravado.

  Os achados `source: :axe` da página são apagados e regravados na mesma transação: varrer a
  página de novo não duplica nada. Achados de outras fontes ficam.
  """
  @spec record_scan_result(Page.t(), map()) ::
          {:ok, Page.t()}
          | {:error, transition_error() | :invalid_scan_result | Ecto.Changeset.t()}
  def record_scan_result(%Page{id: page_id}, result) do
    case PageData.sanitize(result) do
      %{"axe" => %{} = axe} = result -> Repo.transact(fn -> save_scan(page_id, result, axe) end)
      _invalid -> {:error, :invalid_scan_result}
    end
  end

  @doc "Marca a página `failed` com o código de erro e atualiza a auditoria."
  @spec record_scan_failure(Page.t(), atom()) ::
          {:ok, Page.t()} | {:error, transition_error() | Ecto.Changeset.t()}
  def record_scan_failure(%Page{id: page_id}, code) when is_atom(code) do
    Repo.transact(fn ->
      with {:ok, page, audit} <- lock_pending(page_id),
           {:ok, page} <-
             Repo.update(
               Page.status_changeset(page, %{status: :failed, error: Atom.to_string(code)})
             ),
           {:ok, _audit} <- refresh_audit(audit, now()) do
        {:ok, page}
      end
    end)
  end

  defp save_scan(page_id, result, axe) do
    now = now()

    with {:ok, page, audit} <- lock_pending(page_id),
         {:ok, page} <- Repo.update(Page.scan_changeset(page, scan_attrs(result, axe, now))),
         {_deleted, _} <- Repo.delete_all(axe_findings_query(page.id)),
         {:ok, _count} <- insert_findings(page, axe, now),
         {:ok, _audit} <- refresh_audit(audit, now) do
      {:ok, page}
    end
  end

  defp scan_attrs(result, axe, now) do
    %{
      status: :done,
      error: nil,
      final_url: result["final_url"],
      http_status: result["http_status"],
      title: PageData.truncate_bytes(result["title"], @title_max_bytes),
      axe_version: axe["version"],
      scanned_at: now
    }
  end

  defp axe_findings_query(page_id) do
    from f in Finding, where: f.page_id == ^page_id and f.source == :axe
  end

  # Valida cada achado pelo changeset e grava em lotes. Um achado inválido desfaz a transação.
  defp insert_findings(page, axe, now) do
    axe
    |> AxeMapper.to_findings()
    |> Enum.reduce_while({:ok, []}, fn attrs, {:ok, rows} ->
      attrs = Map.merge(attrs, %{page_id: page.id, audit_id: page.audit_id})

      case Ecto.Changeset.apply_action(Finding.changeset(%Finding{}, attrs), :insert) do
        {:ok, finding} -> {:cont, {:ok, [row(finding, now) | rows]}}
        {:error, changeset} -> {:halt, {:error, changeset}}
      end
    end)
    |> case do
      {:ok, rows} ->
        rows
        |> Enum.reverse()
        |> Enum.chunk_every(@insert_chunk_size)
        |> Enum.reduce({:ok, 0}, fn chunk, {:ok, total} ->
          {inserted, _} = Repo.insert_all(Finding, chunk)
          {:ok, total + inserted}
        end)

      error ->
        error
    end
  end

  defp row(%Finding{} = finding, now) do
    finding
    |> Map.take(Finding.__schema__(:fields))
    |> Map.merge(%{id: Ecto.UUID.generate(), inserted_at: now, updated_at: now})
  end

  # Recalcula os contadores a partir das páginas (repetir não conta duas vezes) e encerra a
  # auditoria quando nenhuma página está pendente: `completed` se ao menos uma foi varrida,
  # `failed` (com o erro da última página que falhou) se todas falharam. Recebe a auditoria
  # já travada e fora de estado final (`lock_pending/1`).
  # No M1 a auditoria tem uma página só; a pontuação e o canal entram no M2/M3.
  defp refresh_audit(%Audit{} = audit, now) do
    counts =
      from(p in Page,
        where: p.audit_id == ^audit.id,
        group_by: p.status,
        select: {p.status, count()}
      )
      |> Repo.all()
      |> Map.new()

    scanned = Map.get(counts, :done, 0)
    failed = Map.get(counts, :failed, 0)
    pending = @pending_page_statuses |> Enum.map(&Map.get(counts, &1, 0)) |> Enum.sum()

    final =
      cond do
        pending > 0 -> %{}
        scanned > 0 -> %{status: :completed, error: nil, finished_at: now}
        true -> %{status: :failed, error: last_page_error(audit.id), finished_at: now}
      end

    audit
    |> Audit.progress_changeset(Map.merge(%{pages_scanned: scanned, pages_failed: failed}, final))
    |> Repo.update()
  end

  defp last_page_error(audit_id) do
    Repo.one(
      from p in Page,
        where: p.audit_id == ^audit_id and p.status == :failed,
        order_by: [desc: p.updated_at],
        limit: 1,
        select: p.error
    )
  end

  # Trava a página e a auditoria, nessa ordem, e confere que ambas ainda podem mudar.
  # Páginas da mesma auditoria podem terminar ao mesmo tempo (M5); a trava da auditoria
  # serializa o recálculo dos contadores.
  defp lock_pending(page_id) do
    with {:ok, page} <- lock_page(page_id) do
      audit = Repo.one!(from a in Audit, where: a.id == ^page.audit_id, lock: "FOR UPDATE")

      if page.status in @final_page_statuses or audit.status in @final_audit_statuses do
        {:error, :already_finished}
      else
        {:ok, page, audit}
      end
    end
  end

  defp lock_page(page_id) do
    with {:ok, uuid} <- Ecto.UUID.cast(page_id),
         %Page{} = page <- Repo.one(from p in Page, where: p.id == ^uuid, lock: "FOR UPDATE") do
      {:ok, page}
    else
      _not_found -> {:error, :page_not_found}
    end
  end

  defp now, do: DateTime.utc_now(:second)
end
