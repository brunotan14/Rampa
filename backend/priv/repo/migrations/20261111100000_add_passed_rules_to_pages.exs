defmodule Rampa.Repo.Migrations.AddPassedRulesToPages do
  use Ecto.Migration

  # Regras do axe aprovadas na página (RF-RA017, aba "Aprovados"): lista de
  # `{rule_id, wcag_criteria, help, nodes_total}`, sem HTML. `NULL` quer dizer "não coletado"
  # (página que falhou ou varrida por um scanner sem `axe.passes`); `[]`, nenhuma aprovada.
  # O banco confere o tipo e o tamanho em bytes da representação em texto: a lista vem do
  # scanner e não pode crescer sem teto (RNF-RA003).
  def change do
    alter table(:pages) do
      add :passed_rules, :jsonb
    end

    create constraint(:pages, :passed_rules_shape,
             check:
               "passed_rules IS NULL OR (jsonb_typeof(passed_rules) = 'array' " <>
                 "AND octet_length(passed_rules::text) <= 65536)"
           )
  end
end
