# Container `web` do Compose de teste (PRD §11.2): o build do frontend servido por nginx, com
# `/api` e `/socket` repassados ao app pela faixa confiável (o papel do Traefik), na mesma
# origem, como em produção. Só para o E2E integrado das telas (ex.: RF-RA001 CA1, a ida à tela
# de progresso). Em produção o build vai em `priv/static` do app (PRD §7), na
# `feat/deploy-staging`; aí este serviço pode dar lugar ao próprio app.
#
# Contexto de build: a raiz do repositório (ver `web.Dockerfile.dockerignore`).
#
# Build na mesma imagem do Playwright do CI e do runner (Node do `.nvmrc`), fixada por digest;
# servido pelo mesmo nginx das fixtures, também fixado por digest.
FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d AS build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

FROM nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311

COPY infra/test/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/frontend/dist /srv/web
