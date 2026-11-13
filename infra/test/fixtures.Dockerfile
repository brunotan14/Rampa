# Container `fixtures` do Compose de teste (PRD §11.1, RF-RA002): nginx com as páginas de
# `scanner/test/fixtures/` na raiz e os casos de SSRF do E2E (`e2e/integrado/fixtures/`) em
# `/ssrf/`. Configuração em `infra/test/fixtures-nginx.conf`; rotas com contador em
# `infra/test/fixtures-njs.js`.
#
# Contexto de build: a raiz do repositório (ver `fixtures.Dockerfile.dockerignore`). As páginas
# entram na imagem, sem volume: o Compose de teste não depende de compartilhar pastas do host.
#
# Fixada por tag + digest (`docker buildx imagetools inspect nginx:1.30.6-alpine`).
FROM nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311

# O módulo njs já vem na imagem oficial; só falta carregá-lo (contadores do RF-RA029).
RUN sed -i '1i load_module modules/ngx_http_js_module.so;' /etc/nginx/nginx.conf

COPY infra/test/fixtures-nginx.conf /etc/nginx/conf.d/default.conf
COPY infra/test/fixtures-njs.js /etc/nginx/njs/fixtures-njs.js
COPY scanner/test/fixtures/*.html /srv/fixtures/
COPY e2e/integrado/fixtures/ /srv/ssrf/
