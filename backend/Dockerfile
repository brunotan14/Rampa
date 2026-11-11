# Release do Phoenix em várias etapas (PRD §7, Hospedagem e deploy).
#
# Contexto de build: a RAIZ do repositório, porque o backend embute
# `shared/scanner-contract.schema.json` na compilação (`Rampa.Scanner.Contract`):
#
#   docker build -f backend/Dockerfile .                          # MIX_ENV=prod (deploy)
#   docker build -f backend/Dockerfile --build-arg MIX_ENV=e2e .  # Compose de teste
#
# O que entra no contexto está em `backend/Dockerfile.dockerignore`.
#
# Imagens fixadas por tag + digest (a tag pode ser regravada). As versões acompanham o CI
# (`OTP_VERSION` e `ELIXIR_VERSION` no `ci.yml`): Elixir 1.20.5 sobre OTP 29.1.2, Debian
# trixie nas duas etapas. Conferir o digest com `docker buildx imagetools inspect <tag>`.
# Sem `apt-get`: a imagem `erlang:*-slim` já traz as bibliotecas de que a ERTS precisa
# (OpenSSL, ncurses, libstdc++) e nenhuma dependência do Mix compila código nativo. As
# imagens slim não têm certificados de CA (o `mix local.hex` precisa deles, e a chamada à
# API de IA vai precisar no M4): o pacote de CAs da Mozilla vem da imagem do Alpine.
ARG BUILDER_IMAGE=elixir:1.20.5-otp-29-slim@sha256:610dfb3dd85f9e23af58b431f4907ebce66ae59fca9b462eed2e02d9f0baef89
ARG RUNNER_IMAGE=erlang:29.1.2-slim@sha256:2110a9edc88a9788c07069e78fab3662fc91477b7902433a8b8bad9c852b0d1b
ARG CERTS_IMAGE=alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

FROM ${CERTS_IMAGE} AS certs

FROM ${BUILDER_IMAGE} AS build
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /app/backend
RUN mix local.hex --force && mix local.rebar --force

# Dependências primeiro: mudam pouco e ficam em camadas próprias no cache. O download vem
# antes do `MIX_ENV` e baixa as de todos os ambientes (as de dev e test só ocupam o
# `deps/` do build, não entram na release): assim as releases `prod` e `e2e` dividem as
# camadas do Hex e do `deps.get`, e só a compilação é separada por ambiente.
COPY backend/mix.exs backend/mix.lock ./
RUN mix deps.get

# `prod` para o deploy; `e2e` só para o Compose de teste (config/e2e.exs).
ARG MIX_ENV=prod
ENV MIX_ENV=${MIX_ENV}

COPY backend/config/config.exs backend/config/${MIX_ENV}.exs config/
RUN mix deps.compile

# `shared/` ao lado de `backend/`, como no repositório.
COPY shared/scanner-contract.schema.json /app/shared/
COPY backend/priv priv
COPY backend/lib lib
RUN mix compile --warnings-as-errors

# `runtime.exs` só é lido na subida; mudar ele não recompila nada.
COPY backend/config/runtime.exs config/
COPY backend/rel rel
RUN mix release

FROM ${RUNNER_IMAGE} AS runtime

ARG MIX_ENV=prod
ENV LANG=C.UTF-8 MIX_ENV=${MIX_ENV}
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /app
# A release escreve o `sys.config` gerado do `runtime.exs` em `tmp/` na subida: só esse
# diretório pertence ao usuário do app; o resto fica só para leitura.
COPY --from=build /app/backend/_build/${MIX_ENV}/rel/rampa ./
RUN mkdir -p tmp && chown nobody:nogroup tmp
ENV RELEASE_TMP=/app/tmp ERL_CRASH_DUMP=/app/tmp/erl_crash.dump

# Sem privilégio (uid 65534).
USER nobody:nogroup

EXPOSE 4000
# `bin/migrate` roda as migrations, `bin/server` sobe o app com o HTTP ligado e
# `bin/health` é o healthcheck do container.
CMD ["/app/bin/server"]
