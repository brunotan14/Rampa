defmodule Rampa.Repo.Migrations.AddLoginWallAndHttpStatus do
  use Ecto.Migration

  # RF-RA028 e RF-RA029. Só acrescenta (expandir): colunas anuláveis sem padrão e uma tabela
  # nova. A versão anterior do app não lê nem escreve nada disto, então o rollback do deploy
  # continua funcionando com a migration aplicada.
  #
  #   * `audits.error_http_status`: o status HTTP da página cuja falha encerrou a auditoria,
  #     junto com `audits.error` (a mesma página). Faixa do status de erro do contrato do
  #     scanner (`Rampa.Scanner.Contract.error_http_status_range/0`, 400 a 599);
  #   * `pages.login_wall`: a página pede login, segundo `Rampa.Audits.LoginWall`. `NULL` = não
  #     sabido (fatos ausentes, página varrida antes desta versão);
  #   * `login_wall_daily`: a medição do RF-RA028, agregada por dia de São Paulo, sem URL, sem
  #     host e sem nada que identifique quem pediu. Sobrevive à retenção das auditorias.
  #
  # Travas: o app trava sempre auditoria → página (`Rampa.Audits`), e o app anterior continua
  # no ar durante o `bin/migrate`. Por isso `audits` é alterada antes de `pages`: a migration
  # pede as travas exclusivas na mesma ordem do app e não fecha um ciclo com uma transação
  # dele. O CHECK entra sem validar (`validate: false`: o `ALTER` não varre `audits` com a
  # trava exclusiva) e é validado na migration seguinte, em outra transação, com
  # `VALIDATE CONSTRAINT`, que não bloqueia leituras nem escritas (uma migration é uma
  # transação: validar aqui seguraria a trava do `ALTER` até o fim). Cada `ALTER` espera no
  # máximo o `lock_timeout` da release (5 s).
  def change do
    alter table(:audits) do
      add :error_http_status, :integer
    end

    create constraint(:audits, :error_http_status_range,
             check:
               "error_http_status IS NULL OR (error_http_status >= 400 AND error_http_status <= 599)",
             validate: false
           )

    alter table(:pages) do
      add :login_wall, :boolean
    end

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
