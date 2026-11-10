defmodule Rampa.Repo.Migrations.CreateAuditsPagesFindings do
  use Ecto.Migration

  # Modelo de dados do PRD §8. Colunas que só passam a ser usadas em marcos seguintes
  # (pontuação, IA, recortes de tela) já existem e ficam nulas até lá.
  def change do
    create table(:audits, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :start_url, :text, null: false
      add :page_limit, :integer, null: false, default: 1
      add :status, :string, null: false, default: "queued"
      add :score, :integer
      add :pages_found, :integer, null: false, default: 0
      add :pages_scanned, :integer, null: false, default: 0
      add :pages_failed, :integer, null: false, default: 0
      add :requester_ip_hash, :string
      add :error, :string
      add :started_at, :utc_datetime
      add :finished_at, :utc_datetime
      add :expires_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create constraint(:audits, :page_limit_range, check: "page_limit BETWEEN 1 AND 25")
    create constraint(:audits, :score_range, check: "score BETWEEN 0 AND 100")

    create table(:pages, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :audit_id, references(:audits, type: :binary_id, on_delete: :delete_all), null: false
      add :url, :text, null: false
      add :final_url, :text
      add :http_status, :integer
      add :title, :text
      add :status, :string, null: false, default: "queued"
      add :error, :string
      add :axe_version, :string
      add :scanned_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:pages, [:audit_id, :url])

    create table(:findings, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :page_id, references(:pages, type: :binary_id, on_delete: :delete_all), null: false
      add :audit_id, references(:audits, type: :binary_id, on_delete: :delete_all), null: false
      add :source, :string, null: false
      add :rule_id, :string, null: false
      add :wcag_criteria, {:array, :string}, null: false, default: []
      add :severity, :string, null: false
      add :needs_review, :boolean, null: false, default: false
      add :confidence, :float
      add :selector, :text
      add :html_snippet, :text
      add :message, :text
      add :who_is_affected, :text
      add :how_to_fix, :text
      add :ai_reason, :text
      add :ai_suggestion, :text
      add :ai_model, :string
      add :prompt_version, :string
      add :crop_path, :string
      add :raw, :map

      timestamps(type: :utc_datetime)
    end

    create index(:findings, [:audit_id])
    create index(:findings, [:page_id])

    # Defesa em profundidade para a regra de privacidade (RNF-RA005): o banco recusa trecho > 2 KB.
    create constraint(:findings, :html_snippet_max_2kb,
             check: "octet_length(html_snippet) <= 2048"
           )

    create constraint(:findings, :confidence_range, check: "confidence BETWEEN 0 AND 1")
  end
end
