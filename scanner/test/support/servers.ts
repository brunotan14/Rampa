import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Hit {
  url: string;
  method: string;
  headers: IncomingMessage["headers"];
  body: string;
  // Endereço local da conexão: diz se o pedido chegou pelo 127.0.0.1 ou pelo ::1.
  local: string;
}

export interface LocalServers {
  port: number;
  hits: Hit[];
  // Pedidos que chegaram pelo ::1 (o endereço "privado" nos testes de rebinding).
  ipv6Hits: Hit[];
  ipv6: boolean;
  // Pedidos de WebSocket (`Upgrade`) recebidos; todos são recusados.
  upgrades: () => number;
  close(): Promise<void>;
}

// Servidor HTTP local em 127.0.0.1 e, se der, também em [::1] na mesma porta.
export async function startServers(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<LocalServers> {
  const hits: Hit[] = [];
  const ipv6Hits: Hit[] = [];
  const open = new Set<ServerResponse>();
  const listener: RequestListener = (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const hit = { url: req.url ?? "", method: req.method ?? "", headers: req.headers, body, local: req.socket.localAddress ?? "" };
      (hit.local.includes(":") && !hit.local.startsWith("::ffff:") ? ipv6Hits : hits).push(hit);
      open.add(res);
      res.on("close", () => open.delete(res));
      handler(req, res, body);
    });
  };

  let upgrades = 0;
  const countUpgrade = (server: Server) =>
    server.on("upgrade", (_req, socket) => {
      upgrades += 1;
      socket.destroy();
    });

  const ipv4 = createServer(listener);
  countUpgrade(ipv4);
  await new Promise<void>((resolve) => ipv4.listen(0, "127.0.0.1", resolve));
  const port = (ipv4.address() as AddressInfo).port;

  const servers: Server[] = [ipv4];
  let ipv6 = false;
  const v6 = createServer(listener);
  countUpgrade(v6);
  try {
    await new Promise<void>((resolve, reject) => {
      v6.once("error", reject);
      v6.listen(port, "::1", resolve);
    });
    servers.push(v6);
    ipv6 = true;
  } catch {
    // Sem IPv6 local: os testes de rebinding são pulados.
  }

  return {
    port,
    hits,
    ipv6Hits,
    ipv6,
    upgrades: () => upgrades,
    async close() {
      for (const res of open) res.destroy();
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    },
  };
}
