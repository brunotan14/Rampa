defmodule Rampa.Repo.Migrations.AddLoginWallAndHttpStatus do
  use Ecto.Migration

  # RF-RA028 e RF-RA029. Só acrescenta (expandir): colunas anuláveis sem padrão e uma tabela
  # nova. A versão anterior do app não lê nem escreve nada disto, então o rollback do deploy
  # continua funcionando com a migration aplicada.
  #
  #   * `pages.login_wall`: a página pede login, segundo `Rampa.Audits.LoginWall`. `NULL` = não
  #     sabido (fatos ausentes, página varrida antes desta versão);
  #   * `audits.error_http_status`: o status HTTP da página cuja falha encerrou a auditoria,
  #     junto com `audits.error` (a mesma página). Mesma faixa de `pages.http_status`;
  #   * `login_wall_daily`: a medição do RF-RA028, agregada por dia de São Paulo, sem URL, sem
  #     host e sem nada que identifique quem pediu. Sobrevive à retenção das auditorias.
  def change do
    alter table(:pages) do
      add :login_wall, :boolean
    end

    alter table(:audits) do
      add :error_http_status, :integer
    end

    create constraint(:audits, :error_http_status_range,
             check:
               "error_http_status IS NULL OR (error_http_status >= 100 AND error_http_status <= 599)"
           )

    create table(:login_wall_daily, primary_key: false) do
      add :day, :date, primary_key: true
      add :audits_total, :integer, null: false
      add :audits_with_login_wall, :integer, null: false
    end

    create constraint(:login_wall_daily, :login_wall_counts_valid,
             check: "audits_with_login_wall >= 0 AND audits_with_login_wall <= audits_total"
           )
  end
end
