defmodule Rampa.AuditsFixtures do
  @moduledoc """
  Dados de teste para auditorias, inseridos direto no banco.

  Só para testes: em produção a auditoria nasce em `POST /api/audits`, depois da validação
  de URL e da proteção contra SSRF.
  """

  alias Rampa.Audits.{Audit, Page}
  alias Rampa.Repo

  @scanner_fixtures Path.expand("fixtures/scanner", __DIR__)

  def audit_fixture(attrs \\ %{}) do
    Repo.insert!(struct!(Audit, Map.merge(%{start_url: "https://exemplo.com/"}, attrs)))
  end

  def page_fixture(attrs \\ %{}) do
    {audit, attrs} = Map.pop_lazy(attrs, :audit, fn -> audit_fixture() end)
    Repo.insert!(struct!(Page, Map.merge(%{audit_id: audit.id, url: audit.start_url}, attrs)))
  end

  @doc """
  Resposta real do scanner para uma fixture (`img-sem-alt`, `limpa`, `contraste-incerto`),
  gerada rodando `POST /scan` contra `scanner/test/fixtures/<nome>.html`.
  """
  def scanner_response(name) do
    @scanner_fixtures |> Path.join("#{name}.json") |> File.read!() |> Jason.decode!()
  end
end
