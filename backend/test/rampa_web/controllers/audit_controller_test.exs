defmodule RampaWeb.AuditControllerTest do
  use RampaWeb.ConnCase, async: true
  use Oban.Testing, repo: Rampa.Repo

  import Ecto.Query
  import Mox
  import Rampa.AuditsFixtures

  alias Rampa.Audits.{Audit, Limits, Page, ScanPageJob}
  alias Rampa.Repo
  alias Rampa.Scanner.ClientMock
  alias Rampa.Security.{IPHash, ResolverMock}

  setup :verify_on_exit!

  @public_ip {93, 184, 215, 14}

  # Cada teste vem de um IP próprio: a trava consultiva de um solicitante não segura outro
  # teste.
  setup %{conn: conn} do
    ip = {198, 51, :rand.uniform(254), :rand.uniform(254)}
    %{conn: %{conn | remote_ip: ip}, ip: ip}
  end

  defp stub_public_dns, do: stub(ResolverMock, :resolve, fn _host -> {:ok, [@public_ip]} end)

  defp create(conn, body), do: post(conn, ~p"/api/audits", body)

  defp count_audits, do: Repo.aggregate(Audit, :count)

  defp error_body(conn, status) do
    assert %{"error" => %{"code" => code, "message" => message} = error} =
             json_response(conn, status)

    assert is_binary(message) and message != ""
    {code, error}
  end

  describe "POST /api/audits: RF-RA001" do
    test "URL pública válida: 202 com o id; auditoria, página, tarefa e job criados",
         %{conn: conn} do
      stub_public_dns()

      conn = create(conn, %{url: "https://exemplo.com/"})

      assert %{"id" => id} = json_response(conn, 202)
      assert map_size(json_response(conn, 202)) == 1
      assert %Audit{status: :queued, start_url: "https://exemplo.com/"} = Repo.get!(Audit, id)
      assert [%Page{id: page_id}] = Repo.all(from p in Page, where: p.audit_id == ^id)
      assert_enqueued(worker: ScanPageJob, args: %{"page_id" => page_id})
    end

    for url <- ["ftp://exemplo.com", "javascript:alert(1)"] do
      test "#{url}: só endereços web, nada criado", %{conn: conn} do
        conn = create(conn, %{url: unquote(url)})

        assert {"unsupported_scheme", %{"message" => message}} = error_body(conn, 422)
        assert message == "Só endereços web (http:// ou https://) podem ser auditados."
        assert count_audits() == 0
        refute_enqueued(worker: ScanPageJob)
      end
    end

    test "exemplo.com sem esquema vira https://exemplo.com/", %{conn: conn} do
      stub_public_dns()

      %{"id" => id} = conn |> create(%{url: "exemplo.com"}) |> json_response(202)

      assert %{"start_url" => "https://exemplo.com/"} =
               build_conn() |> get(~p"/api/audits/#{id}") |> json_response(200)
    end

    test "URL inválida: credenciais e mais de 2.048 caracteres", %{conn: conn} do
      for url <- [
            "https://user:senha@exemplo.com/",
            "https://exemplo.com/" <> String.duplicate("a", 2_100)
          ] do
        assert {"invalid_url", _} = conn |> create(%{url: url}) |> error_body(422)
      end
    end

    test "page_limit é conferido; no M1 a auditoria tem uma página", %{conn: conn} do
      for limit <- [0, 26, "5", 2.5] do
        assert {"invalid_page_limit", _} =
                 conn
                 |> create(%{url: "https://exemplo.com/", page_limit: limit})
                 |> error_body(422)
      end

      stub_public_dns()

      %{"id" => id} =
        conn |> create(%{url: "https://exemplo.com/", page_limit: 10}) |> json_response(202)

      assert %Audit{page_limit: 1} = Repo.get!(Audit, id)
    end

    test "url só no corpo: na query string, com corpo vazio, é 400", %{conn: conn} do
      stub_public_dns()

      assert {"invalid_body", _} =
               conn
               |> post("/api/audits?url=https://exemplo.com/&page_limit=1")
               |> error_body(400)

      assert count_audits() == 0
    end

    test "corpo sem url, ou com url que não é texto: 400", %{conn: conn} do
      for body <- [%{}, %{url: 123}, %{endereco: "https://exemplo.com/"}] do
        assert {"invalid_body", _} = conn |> create(body) |> error_body(400)
      end
    end

    test "JSON malformado: 400 no formato do PRD", %{conn: conn} do
      {status, _headers, body} =
        assert_error_sent(400, fn ->
          conn
          |> put_req_header("content-type", "application/json")
          |> post(~p"/api/audits", "{url:")
        end)

      assert status == 400
      assert %{"error" => %{"code" => "invalid_body", "message" => _}} = Jason.decode!(body)
    end
  end

  describe "POST /api/audits: RF-RA002, endereços" do
    test "localhost:4000 e 169.254.169.254: \"Este endereço não pode ser auditado\"",
         %{conn: conn} do
      for url <- ["http://localhost:4000", "http://169.254.169.254/"] do
        {code, %{"message" => message}} = conn |> create(%{url: url}) |> error_body(422)

        assert code == "blocked_address"
        assert message =~ "Este endereço não pode ser auditado"
      end

      assert count_audits() == 0
    end

    test "domínio que resolve para 10.0.0.5 é recusado e nada é criado", %{conn: conn} do
      expect(ResolverMock, :resolve, fn "interno.exemplo.com" -> {:ok, [{10, 0, 0, 5}]} end)

      {code, %{"message" => message}} =
        conn |> create(%{url: "https://interno.exemplo.com/"}) |> error_body(422)

      assert code == "blocked_address"
      assert message =~ "Este endereço não pode ser auditado"
      assert count_audits() == 0
      refute_enqueued(worker: ScanPageJob)
    end

    test "domínio inexistente: 422; falha do resolvedor: 503", %{conn: conn} do
      expect(ResolverMock, :resolve, fn _host -> {:error, :nxdomain} end)

      assert {"unresolvable", _} =
               conn |> create(%{url: "https://nao.exemplo.com/"}) |> error_body(422)

      expect(ResolverMock, :resolve, fn _host -> {:error, :timeout} end)

      assert {"dns_error", _} =
               conn |> create(%{url: "https://lento.exemplo.com/"}) |> error_body(503)
    end
  end

  describe "POST /api/audits: RF-RA002, limites" do
    test "sexta auditoria na mesma hora: 429 com o horário de nova tentativa",
         %{conn: conn, ip: ip} do
      stub_public_dns()
      oldest = DateTime.add(DateTime.utc_now(:second), -30 * 60)

      for i <- 0..4 do
        audit_fixture(%{
          requester_ip_hash: IPHash.hash(ip),
          inserted_at: DateTime.add(oldest, i * 60)
        })
      end

      conn = create(conn, %{url: "https://exemplo.com/"})

      assert {"rate_limited", %{"message" => message, "retry_after" => retry_after}} =
               error_body(conn, 429)

      expected = Limits.ceil_minute(DateTime.add(oldest, 3_600))
      assert {:ok, ^expected, 0} = DateTime.from_iso8601(retry_after)
      assert message =~ "a partir das #{Limits.local_time(expected)}"
      assert message =~ ~r/\d{2}:\d{2}\.\z/

      assert [retry_seconds] = get_resp_header(conn, "retry-after")
      seconds = String.to_integer(retry_seconds)
      assert seconds > 0 and seconds <= 31 * 60

      assert count_audits() == 5
    end

    test "X-Forwarded-For forjado não fura o limite", %{conn: conn, ip: ip} do
      stub_public_dns()

      for _ <- 1..5, do: audit_fixture(%{requester_ip_hash: IPHash.hash(ip)})

      for forged <- ["1.2.3.4", "8.8.8.8, 9.9.9.9", "#{:inet.ntoa(@public_ip)}"] do
        assert {"rate_limited", _} =
                 conn
                 |> put_req_header("x-forwarded-for", forged)
                 |> create(%{url: "https://exemplo.com/"})
                 |> error_body(429)
      end

      assert count_audits() == 5
    end

    test "teto diário: 429 daily_limit_reached até a meia-noite de São Paulo", %{conn: conn} do
      for i <- 1..Limits.config().daily, do: audit_fixture(%{requester_ip_hash: "outro-#{i}"})

      stub_public_dns()
      # Antes e depois da requisição: o teste pode rodar na virada do dia.
      before = Limits.next_day_start(DateTime.utc_now())
      conn = create(conn, %{url: "https://exemplo.com/"})
      later = Limits.next_day_start(DateTime.utc_now())

      assert {"daily_limit_reached", %{"message" => message, "retry_after" => retry_after}} =
               error_body(conn, 429)

      assert message =~ "amanhã"
      assert {:ok, next_midnight, 0} = DateTime.from_iso8601(retry_after)
      assert next_midnight in [before, later]

      assert [seconds] = get_resp_header(conn, "retry-after")
      assert String.to_integer(seconds) in 1..(25 * 3_600)
    end
  end

  describe "POST /api/audits: Idempotency-Key" do
    test "a mesma chave devolve o mesmo id sem criar outra auditoria", %{conn: conn} do
      stub_public_dns()
      conn = put_req_header(conn, "idempotency-key", "tentativa-1")

      %{"id" => first} = conn |> create(%{url: "https://exemplo.com/"}) |> json_response(202)
      %{"id" => again} = conn |> create(%{url: "https://exemplo.com/"}) |> json_response(202)

      assert again == first
      assert count_audits() == 1
    end

    test "a mesma chave com outra URL: 422 idempotency_key_reused", %{conn: conn} do
      stub_public_dns()
      conn = put_req_header(conn, "idempotency-key", "tentativa-2")

      conn |> create(%{url: "https://exemplo.com/a"}) |> json_response(202)

      assert {"idempotency_key_reused", %{"message" => message}} =
               conn |> create(%{url: "https://exemplo.com/b"}) |> error_body(422)

      assert message =~ "Idempotency-Key"
      assert count_audits() == 1
    end

    test "chave inválida ou repetida no cabeçalho: 422", %{conn: conn} do
      assert {"invalid_idempotency_key", _} =
               conn
               |> put_req_header("idempotency-key", String.duplicate("a", 129))
               |> create(%{url: "https://exemplo.com/"})
               |> error_body(422)

      conn =
        conn
        |> Map.update!(:req_headers, &[{"idempotency-key", "a"}, {"idempotency-key", "b"} | &1])
        |> create(%{url: "https://exemplo.com/"})

      assert {"invalid_idempotency_key", _} = error_body(conn, 422)
    end
  end

  describe "GET /api/audits/:id" do
    test "campos do resumo, sem o hash do IP nem a chave de idempotência", %{conn: conn} do
      audit =
        audit_fixture(%{requester_ip_hash: "segredo-hash", idempotency_key: "segredo-chave"})

      page = page_fixture(%{audit: audit, status: :done})
      finding_fixture(page)
      finding_fixture(page, %{needs_review: true, severity: :serious})

      body = conn |> get(~p"/api/audits/#{audit.id}") |> json_response(200)

      assert Map.keys(body) |> Enum.sort() ==
               Enum.sort(~w(id revision status start_url page_limit pages_found pages_scanned
                            pages_failed score totals_by_severity needs_review_by_severity
                            needs_review_count top_issues error started_at finished_at
                            inserted_at))

      assert body["totals_by_severity"] == %{
               "critical" => 1,
               "serious" => 0,
               "moderate" => 0,
               "minor" => 0
             }

      assert body["needs_review_count"] == 1
      assert body["error"] == nil
      refute inspect(body) =~ "segredo"
    end

    test "RF-RA003 ponta a ponta: image-alt vira total crítico e achado com 1.1.1",
         %{conn: conn} do
      stub_public_dns()

      %{"id" => id} =
        conn |> create(%{url: "https://exemplo.com/img-sem-alt.html"}) |> json_response(202)

      [page] = Repo.all(from p in Page, where: p.audit_id == ^id)
      expect(ClientMock, :scan, fn _url -> {:ok, scanner_response("img-sem-alt")} end)
      assert :ok = perform_job(ScanPageJob, %{"page_id" => page.id})

      summary = build_conn() |> get(~p"/api/audits/#{id}") |> json_response(200)

      assert %{"status" => "completed", "pages_scanned" => 1, "pages_failed" => 0} = summary
      assert summary["totals_by_severity"]["critical"] >= 1

      # RF-RA004: a mesma revision do canal, que subiu na criação, no início e no fim do scan.
      assert {:ok, %{revision: revision}} = Rampa.Audits.get_progress(id)
      assert summary["revision"] == revision
      assert revision == 3
      assert is_binary(summary["started_at"]) and is_binary(summary["finished_at"])

      %{"data" => findings} =
        build_conn() |> get(~p"/api/audits/#{id}/findings") |> json_response(200)

      assert Enum.any?(findings, fn finding ->
               finding["rule_id"] == "image-alt" and "1.1.1" in finding["wcag_criteria"] and
                 finding["severity"] == "critical"
             end)
    end

    test "RF-RA002: redirecionamento para IP privado marca erro de acesso com a mensagem",
         %{conn: conn} do
      stub_public_dns()

      %{"id" => id} =
        conn |> create(%{url: "https://exemplo.com/redireciona"}) |> json_response(202)

      [page] = Repo.all(from p in Page, where: p.audit_id == ^id)

      expect(ClientMock, :scan, fn _url ->
        {:error, %{code: :blocked_address, detail: "redirecionamento para http://127.0.0.1/"}}
      end)

      assert {:cancel, :blocked_address} = perform_job(ScanPageJob, %{"page_id" => page.id})

      body = build_conn() |> get(~p"/api/audits/#{id}") |> json_response(200)

      assert %{"status" => "failed", "pages_failed" => 1} = body
      assert %{"code" => "blocked_address", "message" => message} = body["error"]
      assert message =~ "Este endereço não pode ser auditado"
    end

    test "id inválido ou inexistente: 404 com a mesma resposta", %{conn: conn} do
      missing = conn |> get(~p"/api/audits/#{Ecto.UUID.generate()}") |> json_response(404)
      invalid = conn |> get(~p"/api/audits/nao-e-uuid") |> json_response(404)

      assert missing == invalid
      assert %{"error" => %{"code" => "audit_not_found", "message" => _}} = missing
    end
  end

  test "rota inexistente da API: 404 no formato do PRD", %{conn: conn} do
    assert %{"error" => %{"code" => "not_found", "message" => _}} =
             conn |> get("/api/nao-existe") |> json_response(404)
  end
end
