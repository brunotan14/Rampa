defmodule Rampa.Audits.Limits do
  @moduledoc """
  Limites de criação de auditorias (RF-RA002), usados por `Rampa.Audits.create_audit/3`
  dentro da transação de criação:

    * **por solicitante:** `:per_ip_per_hour` auditorias por hash de IP na última hora
      (janela deslizante, `AUDITS_PER_IP_PER_HOUR`, padrão 5);
    * **teto diário:** `:daily` auditorias no total por dia de São Paulo
      (`AUDITS_DAILY_LIMIT`, padrão 50).

  Só auditorias criadas contam: tentativa recusada não grava nada.

  ## Travas consultivas

  A contagem e a inserção ficam serializadas por `pg_advisory_xact_lock`, liberado no fim da
  transação. São duas travas, **sempre nesta ordem**:

    1. a do solicitante (`lock_requester/1`), com chave derivada do `requester_ip_hash`;
    2. a global (`lock_global/0`).

  Solicitante antes do global: uma rajada de um mesmo IP fica na fila da trava dele e não
  segura a trava global; a idempotência e o limite por hora são decididos antes de entrar
  na fila global. Nenhum outro código toma essas travas, e quem as toma não tem trava de
  linha nenhuma (a auditoria nova é inserida depois delas), então não há ciclo de espera
  com as travas `FOR UPDATE` do ciclo de vida.

  As travas usam a forma de duas chaves `int4` (espaço próprio do Rampa), que não se
  mistura com as travas de uma chave `int8` do Oban.

  ## Horários

  O dia é o de `America/Sao_Paulo` (base de fusos do pacote `tz`). Os horários de nova
  tentativa são arredondados para cima no minuto: é o horário mostrado na mensagem, e antes
  dele a pessoa ainda estaria no limite.
  """

  import Ecto.Query

  alias Rampa.Audits.Audit
  alias Rampa.Repo

  @time_zone "America/Sao_Paulo"
  @window_seconds 3_600

  # "RAM" + 1 e "RAM" + 2: espaços das travas de duas chaves int4.
  @requester_lock_space 0x52414D01
  @global_lock_space 0x52414D02

  @type config :: %{per_ip_per_hour: pos_integer(), daily: pos_integer()}

  @doc "Limites da configuração (`config :rampa, :audit_limits`), sobrescritos por `overrides`."
  @spec config(keyword()) :: config()
  def config(overrides \\ []) do
    :rampa
    |> Application.fetch_env!(:audit_limits)
    |> Keyword.merge(overrides)
    |> Keyword.take([:per_ip_per_hour, :daily])
    |> Map.new()
  end

  @doc "Fuso dos horários mostrados e do dia do teto diário."
  @spec time_zone() :: String.t()
  def time_zone, do: @time_zone

  @doc "Trava consultiva do solicitante (1ª na ordem)."
  @spec lock_requester(String.t()) :: :ok
  def lock_requester(ip_hash) do
    <<key::signed-32, _rest::binary>> = :crypto.hash(:sha256, ip_hash)
    advisory_lock(@requester_lock_space, key)
  end

  @doc "Trava consultiva global (2ª na ordem)."
  @spec lock_global() :: :ok
  def lock_global, do: advisory_lock(@global_lock_space, 0)

  defp advisory_lock(space, key) do
    Repo.query!("SELECT pg_advisory_xact_lock($1::int4, $2::int4)", [space, key])
    :ok
  end

  @doc """
  Confere o limite por hora do solicitante. Excedido, devolve o horário (arredondado para
  cima no minuto) em que a auditoria mais antiga que ainda conta sai da janela.
  """
  @spec check_hourly(String.t(), pos_integer(), DateTime.t()) ::
          :ok | {:error, {:rate_limited, DateTime.t()}}
  def check_hourly(ip_hash, limit, now) do
    window =
      from a in Audit,
        where:
          a.requester_ip_hash == ^ip_hash and
            a.inserted_at > ^DateTime.add(now, -@window_seconds)

    count = Repo.aggregate(window, :count)

    if count < limit do
      :ok
    else
      # Com `count` auditorias na janela, a nova cabe quando sair a (count - limit + 1)ª
      # mais antiga.
      oldest =
        Repo.one!(
          from a in window,
            order_by: [asc: a.inserted_at],
            offset: ^(count - limit),
            limit: 1,
            select: a.inserted_at
        )

      {:error, {:rate_limited, ceil_minute(DateTime.add(oldest, @window_seconds))}}
    end
  end

  @doc """
  Confere o teto diário (auditorias criadas desde a meia-noite de São Paulo). Excedido,
  devolve a próxima meia-noite de São Paulo.
  """
  @spec check_daily(pos_integer(), DateTime.t()) ::
          :ok | {:error, {:daily_limit_reached, DateTime.t()}}
  def check_daily(limit, now) do
    count =
      Repo.aggregate(from(a in Audit, where: a.inserted_at >= ^day_start(now)), :count)

    if count < limit,
      do: :ok,
      else: {:error, {:daily_limit_reached, next_day_start(now)}}
  end

  @doc "Meia-noite de São Paulo do dia de `now`, em UTC."
  @spec day_start(DateTime.t()) :: DateTime.t()
  def day_start(now) do
    now
    |> DateTime.shift_zone!(@time_zone)
    |> DateTime.to_date()
    |> midnight_utc()
  end

  @doc "Próxima meia-noite de São Paulo depois de `now`, em UTC."
  @spec next_day_start(DateTime.t()) :: DateTime.t()
  def next_day_start(now) do
    now
    |> DateTime.shift_zone!(@time_zone)
    |> DateTime.to_date()
    |> Date.add(1)
    |> midnight_utc()
  end

  # Num dia em que o relógio pula a meia-noite (horário de verão), vale o primeiro instante
  # do dia.
  defp midnight_utc(date) do
    case DateTime.new(date, ~T[00:00:00], @time_zone) do
      {:ok, datetime} -> datetime
      {:ambiguous, first, _second} -> first
      {:gap, _before, after_gap} -> after_gap
    end
    |> DateTime.shift_zone!("Etc/UTC")
    |> DateTime.truncate(:second)
  end

  @doc "Arredonda para cima no minuto."
  @spec ceil_minute(DateTime.t()) :: DateTime.t()
  def ceil_minute(%DateTime{} = datetime) do
    datetime = DateTime.truncate(datetime, :second)

    if datetime.second == 0,
      do: datetime,
      else: DateTime.add(%{datetime | second: 0}, 60)
  end

  @doc "Horário `HH:MM` em São Paulo."
  @spec local_time(DateTime.t()) :: String.t()
  def local_time(datetime),
    do: datetime |> DateTime.shift_zone!(@time_zone) |> Calendar.strftime("%H:%M")
end
