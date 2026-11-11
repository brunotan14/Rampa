# Rampa

Auditor de acessibilidade web com IA, em português do Brasil.

Você informa o endereço de um site. O Rampa percorre as páginas, roda o [axe-core](https://github.com/dequelabs/axe-core) em cada uma e usa IA para avaliar o que a verificação automática não consegue decidir: se o texto alternativo descreve a imagem, se um link faz sentido fora do contexto, se a ordem de foco pelo teclado é lógica e se os títulos representam o conteúdo. O relatório liga cada problema aos critérios da WCAG 2.2 e do eMAG, explicando quem é afetado e como corrigir.

> **Em construção.** O projeto está no primeiro marco: a fundação técnica. Ainda não audita sites.

O Rampa não certifica conformidade: a verificação automática não substitui a avaliação com pessoas e tecnologias assistivas.

## Stack

| Parte | Tecnologia |
|---|---|
| `backend/` | Elixir, Phoenix (API JSON + Channels), PostgreSQL, Oban |
| `frontend/` | React, TypeScript, Vite, React Router, React Aria Components |
| `scanner/` | Node, Playwright (Chromium), axe-core |
| `e2e/` | Playwright + axe nas telas do próprio Rampa |
| `infra/` | Docker Compose |

A interface do Rampa segue a WCAG 2.2 nível AA, e o CI falha com qualquer violação do axe nas telas do próprio produto.

## Rodando localmente

Pré-requisitos: Elixir 1.20 com OTP 29, Node 24 e Docker.

```sh
make setup   # dependências, banco e navegador do Playwright
make dev     # banco e scanner no Docker, Phoenix em :4000, interface em http://localhost:5173
```

Verificar se tudo está de pé: `curl localhost:4000/api/health`.

Documentação da API: a especificação OpenAPI fica em `http://localhost:4000/api/openapi.json` e o Swagger UI, só em dev, em `http://localhost:4000/dev/swagger`.

## Testes

```sh
make test    # unitários: ExUnit (backend), Vitest (frontend e scanner)
make e2e     # Playwright + axe
make lint    # formatação, lint e tipos
make openapi # regenera o contrato da API em shared/openapi.json (o CI confere se está atualizado)
make scanner-contract # regenera scanner/src/contract.gen.ts a partir de shared/scanner-contract.schema.json (o CI confere)
```

## Licença

[AGPL-3.0](LICENSE).
