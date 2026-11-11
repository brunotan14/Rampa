# Imagem oficial do Playwright, na mesma versão do pacote `playwright` do package.json.
# Essa tag traz o Node abaixo, que é a referência do projeto: o `.nvmrc` da raiz (usado na
# máquina local e na CI) precisa ter a mesma versão. Ao trocar a tag, confira com
# `docker run --rm <imagem> node --version` e atualize esta linha e o `.nvmrc` juntos;
# `scanner/test/toolchain.test.ts` falha se eles divergirem.
# Node da imagem: 26.13.0
# Fixada por digest (a tag pode ser regravada); o digest acompanha a tag nos jobs do CI.
FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production HOST=0.0.0.0 PORT=4100
USER pwuser
EXPOSE 4100
CMD ["node", "dist/main.js"]
