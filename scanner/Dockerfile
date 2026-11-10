# Imagem oficial do Playwright, na mesma versão do pacote em package.json
FROM mcr.microsoft.com/playwright:v1.65.0-noble

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
