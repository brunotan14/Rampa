Mox.defmock(Rampa.Scanner.ClientMock, for: Rampa.Scanner.Client)
Mox.defmock(Rampa.Security.ResolverMock, for: Rampa.Security.Resolver)

# `:load`: teste de carga do relatório (`test/rampa/audits/report_load_test.exs`), fora da
# execução padrão; roda com `mix test --only load` (`make test-load`).
ExUnit.start(exclude: [:load])
Ecto.Adapters.SQL.Sandbox.mode(Rampa.Repo, :manual)
