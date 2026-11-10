import { chromium, type Browser, type LaunchOptions } from "playwright";

// O Chromium não tem saída de rede própria (RF-RA002): toda requisição que ele faria sozinho
// vai para um proxy que não existe, e o DNS dele não resolve nada. Só o que passa pelo route
// (`interceptRequests`) chega à rede, buscado pelo Node com o IP validado. Isso fecha o que
// escapa do `route` do Playwright: o salto de um redirecionamento, WebSocket, fetch de
// SharedWorker, preconnect e dns-prefetch.
//   * `proxy`: o Playwright acrescenta `<-loopback>`, então nem localhost escapa do proxy;
//   * `--host-resolver-rules`: nem o nome do proxy, nem os de dns-prefetch resolvem;
//   * `--force-webrtc-ip-handling-policy`: WebRTC só por proxy, sem UDP direto (STUN/TURN).
export const BLACKHOLE_PROXY = "http://chromium-sem-rede.invalid:9";

export const LAUNCH_OPTIONS: LaunchOptions = {
  proxy: { server: BLACKHOLE_PROXY },
  args: ["--host-resolver-rules=MAP * ~NOTFOUND", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
};

export function launchBrowser(): Promise<Browser> {
  return chromium.launch(LAUNCH_OPTIONS);
}
