# Runner dos E2E integrados (`infra/docker-compose.test.yml`, serviço `e2e`): dependências,
# `playwright.integrado.config.ts` e os specs de `integrado/`. A saída fica em `/e2e/out` e
# é copiada para `e2e/test-results/integrado/` pelo `infra/test/run-e2e.sh` (`docker cp`).
#
# Mesma imagem do Playwright do CI e do scanner, fixada por digest (a tag acompanha o
# `@playwright/test` do package.json). Sem `apt-get`: Node, Chromium e bibliotecas já vêm nela.
FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d

WORKDIR /e2e
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && mkdir out && chown pwuser:pwuser out
COPY playwright.integrado.config.ts ./
COPY integrado ./integrado

USER pwuser
ENTRYPOINT ["/e2e/node_modules/.bin/playwright", "test", "-c", "playwright.integrado.config.ts"]
