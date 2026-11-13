import Config

# Release do Compose de teste (`infra/docker-compose.test.yml`, PRD §11.4): a mesma
# configuração de produção (`runtime.exs` exige as mesmas variáveis), com duas diferenças:
#
#   * `config_env()` é `:e2e`, não `:prod`, então a `SSRF_ALLOWLIST` (só o container
#     `fixtures`) é aceita na subida (`Rampa.Security.Allowlist.check_startup/2`), mas só com
#     o marcador `RAMPA_E2E=1` em tempo de execução, que o Compose de teste define. Sem ele,
#     esta release segue as regras de produção (`Rampa.Security.RuntimeEnv`). Em produção o
#     app continua se recusando a subir com a allowlist preenchida;
#   * sem `force_ssl`: no Compose de teste não há Traefik nem HTTPS;
#   * nova tentativa da varredura em 1 s (em produção, 20 s): os critérios do RF-RA029 com
#     503 esperam a segunda tentativa.
#
# Esta imagem nunca vai para a VPS: o deploy usa a release de `MIX_ENV=prod`.

config :logger, level: :info

config :rampa, :scan_retry_backoff_seconds, 1
