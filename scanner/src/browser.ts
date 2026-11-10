import { chromium, type Browser, type LaunchOptions } from "playwright";

// Toda varredura dá ao contexto um proxy de saída próprio (`ssrf/proxy.ts`), que valida
// cada conexão. Estas opções fecham o que não passa por ele (RF-RA002):
//   * `proxy` de lançamento inexistente: contexto criado sem proxy (o padrão do navegador ou
//     um caminho novo que esqueça o proxy) não alcança a rede. O Playwright acrescenta
//     `<-loopback>`, então nem localhost escapa;
//   * `--host-resolver-rules`: o Chromium não resolve nenhum nome (dns-prefetch e o nome do
//     proxy de lançamento); a exceção é o 127.0.0.1, onde escuta o proxy da varredura;
//   * `--force-webrtc-ip-handling-policy`: WebRTC só por proxy, sem UDP direto (STUN/TURN).
export const BLACKHOLE_PROXY = "http://chromium-sem-rede.invalid:9";

export const LAUNCH_OPTIONS: LaunchOptions = {
  proxy: { server: BLACKHOLE_PROXY },
  args: [
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ],
};

export function launchBrowser(): Promise<Browser> {
  return chromium.launch(LAUNCH_OPTIONS);
}
