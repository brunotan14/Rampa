defmodule Rampa.Audits do
  @moduledoc """
  Auditorias, páginas e achados (PRD §8).

  Este módulo ainda não cria auditorias: elas só podem nascer em `POST /api/audits`, depois
  da validação de URL e da proteção contra SSRF (RF-RA001, RF-RA002). Aqui ficam as
  transições usadas pelo `Rampa.Audits.ScanPageJob` (RF-RA003).
  """

  import Ecto.Query

  alias Ecto.Multi
  alias Rampa.Audits.{Audit, AxeMapper, Finding, Page}
  alias Rampa.Repo

  # Limite de parâmetros do PostgreSQL (65 535) dividido pelas colunas de `findings`, com folga.
  @insert_chunk_size 1_000

  @pending_page_statuses [:queued, :scanning, :analyzing]

  @spec get_page(Ecto.UUID.t()) :: Page.t() | nil
  def get_page(id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} -> Page |> Repo.get(uuid) |> Repo.preload(:audit)
      :error -> nil
    end
  end

  @doc "Marca a página `scanning` e a auditoria `running` (com `started_at`, se ainda nulo)."
  @spec start_page_scan(Page.t()) :: {:ok, Page.t()} | {:error, term()}
  def start_page_scan(%Page{} = page) do
    now = now()

    Multi.new()
    |> Multi.update(:page, Page.status_changeset(page, %{status: :scanning, error: nil}))
    |> Multi.run(:audit, fn repo, _changes ->
      audit = lock_audit(repo, page.audit_id)

      audit
      |> Audit.progress_changeset(%{status: :running, started_at: audit.started_at || now})
      |> repo.update()
    end)
    |> transact(:page)
  end

  @doc """
  Grava o resultado do scanner: os fatos da página e um achado por nó do axe.

  Idempotente: os achados `source: :axe` da página são apagados e regravados na mesma
  transação, então repetir a varredura não duplica nada. Achados de outras fontes ficam.
  """
  @spec record_scan_result(Page.t(), map()) :: {:ok, Page.t()} | {:error, term()}
  def record_scan_result(%Page{} = page, %{"axe" => axe} = result) do
    now = now()

    page_changeset =
      Page.scan_changeset(page, %{
        status: :done,
        error: nil,
        final_url: result["final_url"],
        http_status: result["http_status"],
        title: result["title"],
        axe_version: axe["version"],
        scanned_at: now
      })

    Multi.new()
    |> Multi.update(:page, page_changeset)
    |> Multi.delete_all(:delete_findings, axe_findings_query(page.id))
    |> Multi.run(:findings, fn repo, _changes -> insert_findings(repo, page, axe, now) end)
    |> Multi.run(:audit, fn repo, _changes -> refresh_audit(repo, page.audit_id, now) end)
    |> transact(:page)
  end

  @doc "Marca a página `failed` com o código de erro e atualiza a auditoria."
  @spec record_scan_failure(Page.t(), atom()) :: {:ok, Page.t()} | {:error, term()}
  def record_scan_failure(%Page{} = page, code) when is_atom(code) do
    now = now()

    Multi.new()
    |> Multi.update(
      :page,
      Page.status_changeset(page, %{status: :failed, error: Atom.to_string(code)})
    )
    |> Multi.run(:audit, fn repo, _changes -> refresh_audit(repo, page.audit_id, now) end)
    |> transact(:page)
  end

  defp axe_findings_query(page_id) do
    from f in Finding, where: f.page_id == ^page_id and f.source == :axe
  end

  # Valida cada achado pelo changeset e grava em lotes. Um achado inválido desfaz a transação.
  defp insert_findings(repo, page, axe, now) do
    axe
    |> AxeMapper.to_findings()
    |> Enum.reduce_while({:ok, []}, fn attrs, {:ok, acc} ->
      changeset =
        Finding.changeset(
          %Finding{},
          Map.merge(attrs, %{page_id: page.id, audit_id: page.audit_id})
        )

      case Ecto.Changeset.apply_action(changeset, :insert) do
        {:ok, finding} -> {:cont, {:ok, [row(finding, now) | acc]}}
        {:error, changeset} -> {:halt, {:error, changeset}}
      end
    end)
    |> case do
      {:ok, rows} ->
        count =
          rows
          |> Enum.reverse()
          |> Enum.chunk_every(@insert_chunk_size)
          |> Enum.reduce(0, fn chunk, total ->
            {inserted, _} = repo.insert_all(Finding, chunk)
            total + inserted
          end)

        {:ok, count}

      error ->
        error
    end
  end

  defp row(%Finding{} = finding, now) do
    finding
    |> Map.take(Finding.__schema__(:fields))
    |> Map.merge(%{id: Ecto.UUID.generate(), inserted_at: now, updated_at: now})
  end

  # Recalcula os contadores a partir das páginas (repetir o job não conta duas vezes) e
  # encerra a auditoria quando nenhuma página está pendente: `completed` se ao menos uma
  # foi varrida, `failed` (com o erro da última página que falhou) se todas falharam.
  # No M1 a auditoria tem uma página só; a pontuação e o canal entram no M2/M3.
  defp refresh_audit(repo, audit_id, now) do
    audit = lock_audit(repo, audit_id)

    counts =
      from(p in Page,
        where: p.audit_id == ^audit_id,
        group_by: p.status,
        select: {p.status, count()}
      )
      |> repo.all()
      |> Map.new()

    scanned = Map.get(counts, :done, 0)
    failed = Map.get(counts, :failed, 0)
    pending = @pending_page_statuses |> Enum.map(&Map.get(counts, &1, 0)) |> Enum.sum()

    attrs =
      %{pages_scanned: scanned, pages_failed: failed}
      |> Map.merge(final_state(repo, audit, pending, scanned, now))

    audit
    |> Audit.progress_changeset(attrs)
    |> repo.update()
  end

  defp final_state(_repo, _audit, pending, _scanned, _now) when pending > 0, do: %{}

  defp final_state(_repo, _audit, _pending, scanned, now) when scanned > 0,
    do: %{status: :completed, error: nil, finished_at: now}

  defp final_state(repo, audit, _pending, _scanned, now),
    do: %{status: :failed, error: last_page_error(repo, audit.id), finished_at: now}

  defp last_page_error(repo, audit_id) do
    repo.one(
      from p in Page,
        where: p.audit_id == ^audit_id and p.status == :failed,
        order_by: [desc: p.updated_at],
        limit: 1,
        select: p.error
    )
  end

  # Trava a linha da auditoria: páginas da mesma auditoria podem terminar ao mesmo tempo (M5).
  defp lock_audit(repo, audit_id) do
    repo.one!(from a in Audit, where: a.id == ^audit_id, lock: "FOR UPDATE")
  end

  defp transact(multi, key) do
    case Repo.transaction(multi) do
      {:ok, changes} -> {:ok, Map.fetch!(changes, key)}
      {:error, _step, reason, _changes} -> {:error, reason}
    end
  end

  defp now, do: DateTime.utc_now(:second)
end
