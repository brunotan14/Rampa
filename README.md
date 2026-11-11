# Rampa

Auditor de acessibilidade web com IA, em português do Brasil.

Você informa o endereço de um site. O Rampa percorre as páginas, roda o [axe-core](https://github.com/dequelabs/axe-core) em cada uma e usa IA para avaliar o que a verificação automática não consegue decidir: se o texto alternativo descreve a imagem, se um link faz sentido fora do contexto, se a ordem de foco pelo teclado é lógica e se os títulos representam o conteúdo. O relatório liga cada problema aos critérios da WCAG 2.2 e do eMAG, explicando quem é afetado e como corrigir.

> **Em construção.** O primeiro marco de auditoria está pronto: pela API, o Rampa audita uma página com o axe-core, com proteção contra SSRF e limite de uso (veja a documentação em `/api/openapi.json`). A interface do relatório e as análises de IA vêm nos próximos marcos.

O Rampa não certifica conformidade: a verificação automática não substitui a avaliação com pessoas e tecnologias assistivas.

## Stack

| Parte | Tecnologia |
|---|---|
| `backend/` | Elixir, Phoenix (API JSON + Channels), PostgreSQL, Oban |
| `frontend/` | React, TypeScript, Vite, React Router, React Aria Components |
| `scanner/` | Node, Playwright (Chromium), axe-core |
| `e2e/` | Playwright: axe nas telas do próprio Rampa e E2E integrado (API + scanner) |
| `infra/` | Docker Compose |

A interface do Rampa segue a WCAG 2.2 nível AA, e o CI falha com qualquer violação do axe nas telas do próprio produto.

## Rodando localmente

Pré-requisitos: Elixir 1.20 com OTP 29, Node 26 (versão exata no `.nvmrc`; com o nvm, `nvm use` na raiz) e Docker.

```sh
make setup   # dependências, banco e navegador do Playwright
make dev     # banco e scanner no Docker, Phoenix em :4000, interface em http://localhost:5173
```

Verificar se tudo está de pé: `curl localhost:4000/api/health`.

Documentação da API: a especificação OpenAPI fica em `http://localhost:4000/api/openapi.json` e o Swagger UI, só em dev, em `http://localhost:4000/dev/swagger`.

## Testes

```sh
make test    # unitários: ExUnit (backend), Vitest (frontend e scanner)
make e2e     # telas do Rampa: Playwright + axe
make e2e-integrado  # API, scanner e banco reais auditando o site de fixtures (Compose de teste)
make lint    # formatação, lint e tipos
make openapi # regenera o contrato da API em shared/openapi.json (o CI confere se está atualizado)
make scanner-contract # regenera scanner/src/contract.gen.ts a partir de shared/scanner-contract.schema.json (o CI confere)
```

### E2E integrado

`make e2e-integrado` só precisa do Docker. Ele constrói as imagens, sobe o Compose de teste
(`infra/docker-compose.test.yml`), roda os specs de `e2e/integrado/` dentro de um container com
o Playwright, guarda os logs e derruba tudo. O código de saída é o dos testes. Roda também no
CI, no job `E2E integrado (API + scanner)`.

O Compose de teste tem a release do app (`backend/Dockerfile`, `MIX_ENV=e2e`), o scanner real,
o PostgreSQL e o container `fixtures`, um nginx com as páginas de `scanner/test/fixtures/` e os
casos de SSRF de `e2e/integrado/fixtures/`. É o único lugar com `SSRF_ALLOWLIST` preenchida (só
`fixtures`), e todas as redes são internas: nada sai para a internet durante o teste. Antes dos
specs, o script também confere que:

- a release de produção (`MIX_ENV=prod`) e o scanner com `NODE_ENV=production` se recusam a
  subir com a `SSRF_ALLOWLIST` preenchida (`infra/test/check-allowlist-prod.sh`);
- o scanner não alcança o banco, nem pelo nome nem pelo IP (`infra/test/check-network-isolation.sh`).

| Comando | O que faz |
|---|---|
| `make e2e-integrado ARGS="-g fumaça"` | Ciclo completo, com argumentos para o Playwright |
| `make e2e-integrado-up` | Constrói e sobe o Compose de teste, e deixa de pé |
| `make e2e-integrado-run ARGS=...` | Roda os specs no ambiente de pé (reconstrói só o runner) |
| `make e2e-integrado-down` | Guarda os logs e derruba |

Saída em `e2e/test-results/integrado/`: `report/` (relatório HTML), `artifacts/` (traces das
falhas) e `logs/` (logs dos containers). Com o ambiente de pé, os limites de taxa se acumulam
entre execuções; para repetir os testes de limite, derrube e suba de novo.

## Licença

[AGPL-3.0](LICENSE).
