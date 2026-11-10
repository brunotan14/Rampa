Mox.defmock(Rampa.Scanner.ClientMock, for: Rampa.Scanner.Client)
Mox.defmock(Rampa.Security.ResolverMock, for: Rampa.Security.Resolver)

ExUnit.start()
Ecto.Adapters.SQL.Sandbox.mode(Rampa.Repo, :manual)
