defmodule Rampa.Scanner.Client do
  @moduledoc """
  Contrato com o serviço scanner (PRD §7; schema canônico em
  `shared/scanner-contract.schema.json`, embutido em `Rampa.Scanner.Contract`). A
  implementação é escolhida por configuração (`:scanner_client`), para os testes usarem Mox.

  `scan/1` devolve o corpo da resposta de `POST /scan` (mapa com chaves em texto, como veio
  do JSON, já validado contra o schema) ou um erro com um código (e, no `:http_error`, o
  `http_status` do documento). Os sete primeiros vêm do
  scanner (`ScanErrorCode` no schema); os outros são do backend:

    * `:blocked_address`: o endereço, um redirecionamento ou uma navegação do documento
      principal vai para endereço proibido (RF-RA002);
    * `:invalid_url`: o scanner recusou a URL (credenciais, host inválido);
    * `:resource_limit`: a página passou do teto de dados da varredura;
    * `:timeout`: a página não carregou em 30 s ou a análise passou de 90 s;
    * `:http_error`: o documento respondeu com status >= 400. O status vem em
      `http_status` (de 400 a 599), ou `nil` se o scanner não informou (RF-RA029);
    * `:navigation_failed`: a página não abriu;
    * `:analysis_failed`: a página abriu, mas a coleta falhou depois (axe, título, contexto
      destruído por redirecionamento via script);
    * `:invalid_request`: o scanner recusou o pedido (4xx sem código do contrato), um erro
      do lado do backend que não melhora com nova tentativa;
    * `:unavailable`: o scanner não respondeu, respondeu 5xx sem código do contrato ou
      respondeu 200 com um corpo que não é objeto JSON;
    * `:contract_mismatch`: resposta 200 sem `contract_version` ou com outra versão, ou erro
      com código desconhecido e outra versão (scanner e backend em versões diferentes). Um
      erro com código conhecido vale mesmo com outra versão;
    * `:invalid_scan_result`: resposta 200 com a versão certa, mas fora do schema (campo
      obrigatório faltando, tipo errado, acima de um limite).
  """

  @type error_code ::
          :blocked_address
          | :invalid_url
          | :resource_limit
          | :timeout
          | :http_error
          | :navigation_failed
          | :analysis_failed
          | :invalid_request
          | :unavailable
          | :contract_mismatch
          | :invalid_scan_result
  @type scan_error :: %{
          required(:code) => error_code(),
          required(:detail) => String.t(),
          optional(:http_status) => 400..599 | nil
        }

  @callback health() :: :ok | {:error, term()}

  @callback scan(url :: String.t()) :: {:ok, map()} | {:error, scan_error()}

  @spec impl() :: module()
  def impl, do: Application.fetch_env!(:rampa, :scanner_client)
end
