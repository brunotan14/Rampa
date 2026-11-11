defmodule Rampa.Audits.CreateAuditTest do
  use Rampa.DataCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Mox
  import Rampa.AuditsFixtures

  alias Rampa.Audits
  alias Rampa.Audits.{Audit, Limits, Page, PageTask, ScanPageJob}
  alias Rampa.Scanner.ClientMock
  alias Rampa.Security.ResolverMock

  setup :verify_on_exit!

  @public_ip {93, 184, 215, 14}

  # Cada teste tem o próprio solicitante: a trava consultiva dele não segura outros testes.
  setup do
    %{requester: %{ip_hash: "hash-" <> Ecto.UUID.generate()}}
  end

  defp stub_public_dns, do: stub(ResolverMock, :resolve, fn _host -> {:ok, [@public_ip]} end)

  defp count_audits, do: Repo.aggregate(Audit, :count)
  defp pages(audit), do: Repo.all(from p in Page, where: p.audit_id == ^audit.id)

  defp create(url, requester, opts \\ []), do: Audits.create_audit(url, requester, opts)

  defp requester, do: %{ip_hash: "hash-" <> Ecto.UUID.generate()}

  describe "RF-RA001: critérios de aceite" do
    test "URL pública válida: auditoria queued, página, tarefa scan e job, numa transação",
         %{requester: requester} do
      expect(ResolverMock, :resolve, fn "exemplo.com" -> {:ok, [@public_ip]} end)

      assert {:ok, %Audit{} = audit} = create("https://exemplo.com/contato#topo", requester)

      assert %Audit{
               status: :queued,
               start_url: "https://exemplo.com/contato",
               page_limit: 1,
               pages_found: 1,
               requester_ip_hash: ip_hash
             } = Repo.get!(Audit, audit.id)

      assert ip_hash == requester.ip_hash
      assert [%Page{status: :queued, url: "https://exemplo.com/contato"} = page] = pages(audit)
      assert [%PageTask{kind: :scan, status: :pending}] = Repo.all(assoc(page, :tasks))
      assert_enqueued(worker: ScanPageJob, args: %{"page_id" => page.id}, queue: :scan)
    end

    test "ftp://exemplo.com e javascript:alert(1) são recusados e nada é criado",
         %{requester: requester} do
      assert {:error, :unsupported_scheme} = create("ftp://exemplo.com", requester)
      assert {:error, :unsupported_scheme} = create("javascript:alert(1)", requester)

      assert count_audits() == 0
      refute_enqueued(worker: ScanPageJob)
    end

    test "exemplo.com sem esquema vira https://exemplo.com/", %{requester: requester} do
      stub_public_dns()

      assert {:ok, %Audit{start_url: "https://exemplo.com/"}} = create("exemplo.com", requester)
    end

    test "IDN vira punycode antes da validação", %{requester: requester} do
      expect(ResolverMock, :resolve, fn "xn--ao-siap.com.br" -> {:ok, [@public_ip]} end)

      assert {:ok, %Audit{start_url: "https://xn--ao-siap.com.br/"}} =
               create("ação.com.br", requester)
    end
  end

  describe "RF-RA002: endereços recusados" do
    test "localhost:4000 e 169.254.169.254 são bloqueados sem consultar o DNS",
         %{requester: requester} do
      # Sem stub: se o resolver fosse chamado, o Mox falharia.
      assert {:error, :blocked_address} = create("http://localhost:4000", requester)
      assert {:error, :blocked_address} = create("http://169.254.169.254/", requester)

      assert count_audits() == 0
    end

    test "domínio que resolve para 10.0.0.5 é bloqueado e nada é criado",
         %{requester: requester} do
      expect(ResolverMock, :resolve, fn "interno.exemplo.com" -> {:ok, [{10, 0, 0, 5}]} end)

      assert {:error, :blocked_address} = create("https://interno.exemplo.com/", requester)
      assert count_audits() == 0
      refute_enqueued(worker: ScanPageJob)
    end

    test "nome sem registro e falha do resolvedor", %{requester: requester} do
      expect(ResolverMock, :resolve, fn _host -> {:error, :nxdomain} end)
      assert {:error, :unresolvable} = create("https://nao-existe.exemplo.com/", requester)

      expect(ResolverMock, :resolve, fn _host -> {:error, :timeout} end)
      assert {:error, :dns_error} = create("https://instavel.exemplo.com/", requester)

      assert count_audits() == 0
    end

    test "o DNS é consultado uma vez só", %{requester: requester} do
      expect(ResolverMock, :resolve, 1, fn _host -> {:ok, [@public_ip]} end)

      assert {:ok, _audit} = create("https://exemplo.com/", requester)
    end
  end

  describe "page_limit" do
    test "1 a 25 é aceito, mas no M1 a auditoria tem sempre uma página",
         %{requester: requester} do
      stub_public_dns()

      for limit <- [nil, 1, 10, 25] do
        assert {:ok, %Audit{page_limit: 1}} =
                 create("https://exemplo.com/#{limit}", requester,
                   page_limit: limit,
                   limits: [per_ip_per_hour: 10]
                 )
      end
    end

    test "fora de 1..25 ou que não é inteiro é recusado antes do DNS",
         %{requester: requester} do
      for limit <- [0, 26, -1, "5", 2.5, true] do
        assert {:error, :invalid_page_limit} =
                 create("https://exemplo.com/", requester, page_limit: limit)
      end

      assert count_audits() == 0
    end
  end

  describe "idempotência" do
    test "mesma chave com outra URL normalizada é recusada, sem criar nada",
         %{requester: requester} do
      stub_public_dns()
      opts = [idempotency_key: "k-url"]

      assert {:ok, first} = create("https://exemplo.com/a", requester, opts)

      # Mesma URL depois de normalizar: é a mesma requisição.
      assert {:ok, same} = create("HTTPS://Exemplo.com/a#topo", requester, opts)
      assert same.id == first.id

      assert {:error, :idempotency_key_reused} =
               create("https://exemplo.com/b", requester, opts)

      assert count_audits() == 1
    end

    test "a mesma chave do mesmo solicitante devolve a mesma auditoria, sem DNS nem limite",
         %{requester: requester} do
      expect(ResolverMock, :resolve, 1, fn _host -> {:ok, [@public_ip]} end)
      opts = [idempotency_key: "chave-1", limits: [per_ip_per_hour: 1]]

      assert {:ok, first} = create("https://exemplo.com/", requester, opts)
      assert {:ok, again} = create("https://exemplo.com/", requester, opts)

      assert again.id == first.id
      assert count_audits() == 1
      assert [_job] = all_enqueued(worker: ScanPageJob)
    end

    test "a chave é por solicitante", %{requester: requester} do
      stub_public_dns()

      assert {:ok, first} = create("https://exemplo.com/", requester, idempotency_key: "k")
      assert {:ok, other} = create("https://exemplo.com/", requester(), idempotency_key: "k")

      refute other.id == first.id
    end

    test "depois de 24 h a chave vale de novo e cria outra auditoria",
         %{requester: requester} do
      stub_public_dns()
      now = ~U[2026-11-10 12:00:00Z]

      assert {:ok, first} =
               create("https://exemplo.com/", requester, idempotency_key: "k", now: now)

      assert {:ok, same} =
               create("https://exemplo.com/", requester,
                 idempotency_key: "k",
                 now: DateTime.add(now, 86_399)
               )

      assert same.id == first.id

      assert {:ok, second} =
               create("https://exemplo.com/", requester,
                 idempotency_key: "k",
                 now: DateTime.add(now, 86_400)
               )

      refute second.id == first.id
      assert %Audit{idempotency_key: nil} = Repo.get!(Audit, first.id)
      assert %Audit{idempotency_key: "k"} = Repo.get!(Audit, second.id)
    end

    test "chave inválida é recusada", %{requester: requester} do
      for key <- ["", String.duplicate("a", 129), "com espaço", "ação", 123] do
        assert {:error, :invalid_idempotency_key} =
                 create("https://exemplo.com/", requester, idempotency_key: key)
      end

      stub_public_dns()

      assert {:ok, _audit} =
               create("https://exemplo.com/", requester,
                 idempotency_key: String.duplicate("a", 128)
               )
    end
  end

  describe "RF-RA002: limite por hora" do
    test "a sexta auditoria na mesma hora é recusada com o horário de nova tentativa",
         %{requester: requester} do
      stub_public_dns()
      first_at = ~U[2026-11-10 17:00:30Z]

      for minute <- 0..4 do
        assert {:ok, _audit} =
                 create("https://exemplo.com/#{minute}", requester,
                   now: DateTime.add(first_at, minute * 60)
                 )
      end

      now = DateTime.add(first_at, 10 * 60)

      # A mais antiga sai da janela às 18:00:30; arredondado para cima, 18:01 (15:01 em SP).
      assert {:error, {:rate_limited, retry_at}} =
               create("https://exemplo.com/6", requester, now: now)

      assert retry_at == ~U[2026-11-10 18:01:00Z]
      assert Limits.local_time(retry_at) == "15:01"
      assert count_audits() == 5

      # Outro solicitante não é afetado.
      assert {:ok, _audit} = create("https://exemplo.com/", requester(), now: now)

      # Passada a hora da mais antiga, cabe mais uma.
      assert {:ok, _audit} =
               create("https://exemplo.com/6", requester, now: ~U[2026-11-10 18:00:31Z])
    end

    test "tentativas recusadas não contam", %{requester: requester} do
      stub_public_dns()
      opts = [limits: [per_ip_per_hour: 1]]

      assert {:error, :blocked_address} = create("http://localhost/", requester, opts)
      assert {:error, :unsupported_scheme} = create("ftp://exemplo.com/", requester, opts)
      assert {:ok, _audit} = create("https://exemplo.com/", requester, opts)

      assert {:error, {:rate_limited, _retry_at}} =
               create("https://exemplo.com/b", requester, opts)
    end

    test "com o limite reduzido abaixo do que já existe, espera sair o necessário",
         %{requester: requester} do
      stub_public_dns()
      start = ~U[2026-11-10 17:00:00Z]

      for minute <- 0..3 do
        assert {:ok, _audit} =
                 create("https://exemplo.com/#{minute}", requester,
                   now: DateTime.add(start, minute * 60)
                 )
      end

      # 4 na janela e limite 2: a nova cabe quando sair a 3ª mais antiga (17:02 + 1 h).
      assert {:error, {:rate_limited, ~U[2026-11-10 18:02:00Z]}} =
               create("https://exemplo.com/x", requester,
                 now: DateTime.add(start, 600),
                 limits: [per_ip_per_hour: 2]
               )
    end
  end

  describe "RF-RA002: teto diário" do
    test "excedido, recusa até a meia-noite de São Paulo", %{requester: requester} do
      stub_public_dns()
      now = ~U[2026-11-10 15:00:00Z]
      opts = [now: now, limits: [daily: 3]]

      for _ <- 1..3, do: assert({:ok, _audit} = create("https://exemplo.com/", requester(), opts))

      assert {:error, {:daily_limit_reached, ~U[2026-11-11 03:00:00Z]}} =
               create("https://exemplo.com/", requester, opts)

      assert count_audits() == 3

      assert {:ok, _audit} =
               create("https://exemplo.com/", requester,
                 now: ~U[2026-11-11 03:00:00Z],
                 limits: [daily: 3]
               )
    end

    test "conta só o dia de São Paulo", %{requester: requester} do
      stub_public_dns()
      opts = [limits: [daily: 1, per_ip_per_hour: 10]]

      # 23:59 de 10/11 em São Paulo.
      assert {:ok, _audit} =
               create(
                 "https://exemplo.com/",
                 requester(),
                 [now: ~U[2026-11-11 02:59:00Z]] ++ opts
               )

      # 00:01 de 11/11 em São Paulo: dia novo.
      assert {:ok, _audit} =
               create("https://exemplo.com/", requester, [now: ~U[2026-11-11 03:01:00Z]] ++ opts)
    end

    test "o limite por hora é conferido antes do diário", %{requester: requester} do
      stub_public_dns()
      opts = [now: ~U[2026-11-10 15:00:00Z], limits: [daily: 1, per_ip_per_hour: 1]]

      assert {:ok, _audit} = create("https://exemplo.com/", requester, opts)
      assert {:error, {:rate_limited, _}} = create("https://exemplo.com/", requester, opts)

      assert {:error, {:daily_limit_reached, _}} =
               create("https://exemplo.com/", requester(), opts)
    end
  end

  describe "get_audit_summary/1" do
    test "auditoria que terminou com image-alt (resposta real do scanner)",
         %{requester: requester} do
      stub_public_dns()
      assert {:ok, audit} = create("https://exemplo.com/img-sem-alt.html", requester)
      [page] = pages(audit)

      expect(ClientMock, :scan, fn _url -> {:ok, scanner_response("img-sem-alt")} end)
      assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})

      assert {:ok, summary} = Audits.get_audit_summary(audit.id)
      assert %Audit{status: :completed, pages_scanned: 1} = summary.audit
      assert summary.totals_by_severity.critical >= 1
    end

    test "totais por severidade só dos confirmados; os que pedem revisão à parte" do
      page = page_fixture(%{status: :done})
      finding_fixture(page)
      finding_fixture(page, %{severity: :serious, rule_id: "color-contrast"})

      finding_fixture(page, %{
        severity: :critical,
        needs_review: true,
        source: :ai,
        confidence: 0.7
      })

      finding_fixture(page, %{severity: :minor, needs_review: true})

      assert {:ok, summary} = Audits.get_audit_summary(page.audit_id)

      assert summary.totals_by_severity == %{critical: 1, serious: 1, moderate: 0, minor: 0}
      assert summary.needs_review_count == 2
    end

    test "id inválido ou inexistente" do
      assert {:error, :audit_not_found} = Audits.get_audit_summary(Ecto.UUID.generate())
      assert {:error, :audit_not_found} = Audits.get_audit_summary("nao-e-uuid")
    end
  end

  describe "list_findings/2" do
    setup do
      page = page_fixture(%{status: :done})
      base = ~U[2026-11-10 12:00:00Z]

      findings =
        for i <- 0..6 do
          finding_fixture(page, %{
            rule_id: "regra-#{i}",
            severity: Enum.at([:critical, :serious, :moderate, :minor], rem(i, 4)),
            needs_review: rem(i, 2) == 1,
            # Dois achados por segundo: o desempate é pelo id.
            inserted_at: DateTime.add(base, div(i, 2)),
            updated_at: base
          })
        end

      %{page: page, findings: Enum.sort_by(findings, &{&1.inserted_at, &1.id})}
    end

    test "percorre tudo com o cursor, sem repetir nem pular", %{page: page, findings: findings} do
      pages =
        Stream.unfold(:start, fn
          nil ->
            nil

          cursor ->
            params =
              if cursor == :start,
                do: %{"limit" => "3"},
                else: %{"limit" => "3", "cursor" => cursor}

            {:ok, %{data: data, next_cursor: next}} = Audits.list_findings(page.audit_id, params)
            {data, next}
        end)
        |> Enum.to_list()

      assert Enum.map(pages, &length/1) == [3, 3, 1]
      assert pages |> List.flatten() |> Enum.map(& &1.id) == Enum.map(findings, & &1.id)
    end

    test "limite padrão 50 e última página sem cursor", %{page: page} do
      assert {:ok, %{data: data, next_cursor: nil}} = Audits.list_findings(page.audit_id, %{})
      assert length(data) == 7
    end

    test "filtros", %{page: page} do
      assert {:ok, %{data: data}} =
               Audits.list_findings(page.audit_id, %{"severity" => "critical"})

      assert Enum.all?(data, &(&1.severity == :critical)) and length(data) == 2

      assert {:ok, %{data: data}} =
               Audits.list_findings(page.audit_id, %{"needs_review" => "false"})

      assert Enum.all?(data, &(not &1.needs_review)) and length(data) == 4

      assert {:ok, %{data: []}} = Audits.list_findings(page.audit_id, %{"source" => "ai"})

      # i = 2 e i = 6.
      assert {:ok, %{data: [_, _]}} =
               Audits.list_findings(page.audit_id, %{
                 "severity" => "moderate",
                 "needs_review" => "false",
                 "source" => "axe"
               })
    end

    test "valores inválidos", %{page: page} do
      for params <- [
            %{"severity" => "critico"},
            %{"source" => "AXE"},
            %{"needs_review" => "1"},
            %{"severity" => ["critical"]}
          ] do
        assert {:error, :invalid_filter} = Audits.list_findings(page.audit_id, params)
      end

      for limit <- ["0", "101", "abc", "10.5", ["1"]] do
        assert {:error, :invalid_limit} = Audits.list_findings(page.audit_id, %{"limit" => limit})
      end

      for cursor <- [
            "???",
            Base.url_encode64("x:y", padding: false),
            Base.url_encode64("1:nao-uuid")
          ] do
        assert {:error, :invalid_cursor} =
                 Audits.list_findings(page.audit_id, %{"cursor" => cursor})
      end
    end

    test "achados de outra auditoria não aparecem", %{page: page} do
      other = page_fixture(%{status: :done})
      finding_fixture(other)

      assert {:ok, %{data: data}} = Audits.list_findings(page.audit_id, %{"limit" => "100"})
      assert Enum.all?(data, &(&1.audit_id == page.audit_id))
    end

    test "achado gravado no mesmo segundo, com id menor, aparece na página seguinte" do
      page = page_fixture(%{status: :done})
      [small_id, big_id] = Enum.sort([Ecto.UUID.generate(), Ecto.UUID.generate()])

      finding_fixture(page, %{id: big_id, inserted_at: ~U[2026-11-10 12:00:00.100000Z]})

      assert {:ok, %{data: [%{id: ^big_id}], next_cursor: nil}} =
               Audits.list_findings(page.audit_id, %{"limit" => "1"})

      # Página cheia: pede de novo com limite 1 para ter cursor.
      finding_fixture(page, %{id: small_id, inserted_at: ~U[2026-11-10 12:00:00.200000Z]})

      assert {:ok, %{data: [%{id: ^big_id}], next_cursor: cursor}} =
               Audits.list_findings(page.audit_id, %{"limit" => "1"})

      assert {:ok, %{data: [%{id: ^small_id}], next_cursor: nil}} =
               Audits.list_findings(page.audit_id, %{"limit" => "1", "cursor" => cursor})
    end

    test "auditoria inexistente" do
      assert {:error, :audit_not_found} = Audits.list_findings(Ecto.UUID.generate(), %{})
      assert {:error, :audit_not_found} = Audits.list_findings("x", %{})
    end
  end
end
