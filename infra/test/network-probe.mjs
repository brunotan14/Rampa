// Sonda de rede, executada dentro do container do scanner por `check-network-isolation.sh`.
// Sai com 1 se o scanner alcançar o banco por nome ou por IP, ou se o controle falhar.
import { lookup } from "node:dns/promises";
import net from "node:net";

const failures = [];

function connect(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("timeout");
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve("connected");
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolve(error.code ?? String(error));
    });
  });
}

try {
  const addresses = await lookup("postgres", { all: true });
  failures.push(`o nome "postgres" resolve na rede do scanner: ${JSON.stringify(addresses)}`);
} catch (error) {
  console.log(`ok: o nome "postgres" não resolve na rede do scanner (${error.code})`);
}

const ips = (process.env.POSTGRES_IPS ?? "").trim().split(/\s+/).filter(Boolean);
if (ips.length === 0) failures.push("nenhum IP do postgres informado (POSTGRES_IPS)");
for (const ip of ips) {
  const result = await connect(ip, 5432);
  if (result === "connected") failures.push(`o scanner conecta em ${ip}:5432`);
  else console.log(`ok: ${ip}:5432 inacessível a partir do scanner (${result})`);
}

const control = await connect("fixtures", 80);
if (control === "connected") console.log("ok: controle, fixtures:80 acessível a partir do scanner");
else failures.push(`controle falhou: fixtures:80 não conecta (${control})`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FALHOU: ${failure}`);
  process.exit(1);
}
