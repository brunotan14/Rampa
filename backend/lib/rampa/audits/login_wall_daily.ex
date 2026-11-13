defmodule Rampa.Audits.LoginWallDaily do
  @moduledoc """
  Medição do RF-RA028: quantas auditorias encerradas por dia e quantas delas bateram numa
  barreira de login (alguma página com `pages.login_wall = true`). Insumo da decisão "Áreas
  logadas" (PRD §15, em aberto, item 4).

  Sem dado pessoal: uma linha por dia de São Paulo, só com as duas contagens. Nada de URL,
  host, IP ou id de auditoria. Por ser agregada, sobrevive à retenção que apaga as auditorias.

  ## Quando conta

  `count_finished/2` roda na transação que leva a auditoria a estado final (`completed` ou
  `failed`, em `Rampa.Audits`), com a auditoria travada. A passagem a estado final acontece uma
  vez só (estado final não muda mais), então cada auditoria conta uma vez, mesmo com o job
  repetido. A trava da linha do dia vem depois de todas as outras (auditoria → página →
  tarefas → dia): duas auditorias que terminam juntas esperam uma pela outra só no `UPSERT`,
  sem ciclo. É a única contagem incrementada do Rampa (as de `audits` são derivadas): a fonte
  some com a retenção.

  ## Consulta

  `summary/1`, também por `Rampa.Release.login_wall_stats/1` na release
  (`bin/rampa eval 'Rampa.Release.login_wall_stats()'`).
  """

  use Ecto.Schema

  import Ecto.Query

  alias Rampa.Audits.{Limits, Page}
  alias Rampa.Repo

  @primary_key {:day, :date, autogenerate: false}

  @type t :: %__MODULE__{}

  @type summary :: %{
          from: Date.t(),
          to: Date.t(),
          audits_total: non_neg_integer(),
          audits_with_login_wall: non_neg_integer(),
          days: [
            %{
              day: Date.t(),
              audits_total: pos_integer(),
              audits_with_login_wall: non_neg_integer()
            }
          ]
        }

  schema "login_wall_daily" do
    field :audits_total, :integer
    field :audits_with_login_wall, :integer
  end

  @doc """
  Conta a auditoria que acabou de entrar em estado final, no dia de São Paulo de `now`. Chame
  só dentro da transação que encerra a auditoria, com ela travada.
  """
  @spec count_finished(Ecto.UUID.t(), DateTime.t()) :: :ok
  def count_finished(audit_id, %DateTime{} = now) do
    with_login_wall =
      if Repo.exists?(from p in Page, where: p.audit_id == ^audit_id and p.login_wall == true),
        do: 1,
        else: 0

    {1, _} =
      Repo.insert_all(
        __MODULE__,
        [%{day: day(now), audits_total: 1, audits_with_login_wall: with_login_wall}],
        conflict_target: :day,
        on_conflict:
          from(d in __MODULE__,
            update: [
              inc: [audits_total: 1, audits_with_login_wall: ^with_login_wall]
            ]
          )
      )

    :ok
  end

  @doc """
  Medição de um período, por dia e no total. Opções:

    * `:days`: quantos dias até hoje, inclusive (padrão 30);
    * `:from` e `:to`: o período em datas de São Paulo, inclusive (sobrepõem `:days`);
    * `:now`: o instante de referência (testes).
  """
  @spec summary(keyword()) :: summary()
  def summary(opts \\ []) do
    today = opts |> Keyword.get_lazy(:now, &DateTime.utc_now/0) |> day()
    to = Keyword.get(opts, :to, today)
    from = Keyword.get(opts, :from, Date.add(to, 1 - Keyword.get(opts, :days, 30)))

    days =
      Repo.all(
        from d in __MODULE__,
          where: d.day >= ^from and d.day <= ^to,
          order_by: d.day,
          select: %{
            day: d.day,
            audits_total: d.audits_total,
            audits_with_login_wall: d.audits_with_login_wall
          }
      )

    %{
      from: from,
      to: to,
      audits_total: Enum.sum_by(days, & &1.audits_total),
      audits_with_login_wall: Enum.sum_by(days, & &1.audits_with_login_wall),
      days: days
    }
  end

  defp day(now), do: now |> DateTime.shift_zone!(Limits.time_zone()) |> DateTime.to_date()
end
