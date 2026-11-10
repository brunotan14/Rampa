defmodule Rampa.Scanner.Client do
  @moduledoc """
  Contrato com o serviço scanner (PRD §7). A implementação é escolhida por
  configuração (`:scanner_client`), para os testes usarem Mox.

  `scan/1` devolve o corpo da resposta de `POST /scan` (mapa com chaves em texto, como veio
  do JSON) ou um erro com um código. Os quatro primeiros vêm do scanner; os dois últimos são
  do backend:

    * `:blocked_address`: o endereço (ou uma requisição da página) é proibido (RF-RA002);
    * `:timeout`: a página não carregou em 30 s ou a análise passou de 90 s;
    * `:http_error`: o documento respondeu com status >= 400;
    * `:navigation_failed`: a página não abriu;
    * `:analysis_failed`: a página abriu, mas a coleta falhou depois (axe, título, contexto
      destruído por redirecionamento via script);
    * `:invalid_request`: o scanner recusou o pedido (4xx sem código do contrato), um erro
      do lado do backend que não melhora com nova tentativa;
    * `:unavailable`: o scanner não respondeu, respondeu 5xx sem código do contrato ou
      devolveu uma resposta fora do contrato.
  """

  @type error_code ::
          :blocked_address
          | :timeout
          | :http_error
          | :navigation_failed
          | :analysis_failed
          | :invalid_request
          | :unavailable
  @type scan_error :: %{code: error_code(), detail: String.t()}

  @callback health() :: :ok | {:error, term()}

  @callback scan(url :: String.t()) :: {:ok, map()} | {:error, scan_error()}

  @spec impl() :: module()
  def impl, do: Application.fetch_env!(:rampa, :scanner_client)
end
