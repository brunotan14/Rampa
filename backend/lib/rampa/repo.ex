defmodule Rampa.Repo do
  use Ecto.Repo,
    otp_app: :rampa,
    adapter: Ecto.Adapters.Postgres
end
