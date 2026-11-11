# Container `fixtures` do Compose de teste (PRD §11.1, RF-RA002): nginx com as páginas de
# `scanner/test/fixtures/` na raiz e os casos de SSRF do E2E (`e2e/integrado/fixtures/`) em
# `/ssrf/`. Configuração em `infra/test/fixtures-nginx.conf`.
#
# Contexto de build: a raiz do repositório (ver `fixtures.Dockerfile.dockerignore`). As páginas
# entram na imagem, sem volume: o Compose de teste não depende de compartilhar pastas do host.
#
# Fixada por tag + digest (`docker buildx imagetools inspect nginx:1.30.6-alpine`).
FROM nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311

COPY infra/test/fixtures-nginx.conf /etc/nginx/conf.d/default.conf
COPY scanner/test/fixtures/*.html /srv/fixtures/
COPY e2e/integrado/fixtures/ /srv/ssrf/
