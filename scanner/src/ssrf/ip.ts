import { isIP } from "node:net";

// Faixas de IP que o scanner nunca acessa (RF-RA002): as do PRD mais os registros de
// propósito especial da IANA. É a mesma lista do backend (`Rampa.Security.IPRanges`); os
// casos de `shared/ssrf-cases.json` são testados nas duas implementações.

type Range = readonly [network: string, prefix: number];

const IPV4_BLOCKED: readonly Range[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

// `::/96` cobre `::`, `::1` e os IPv4-compatíveis obsoletos. `fec0::/10` (site-local,
// obsoleto), `3fff::/20`, `5f00::/16` e `64:ff9b:1::/48` vêm do registro da IANA.
const IPV6_BLOCKED: readonly Range[] = [
  ["::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

// Prefixos com IPv4 embutido (mapeado, NAT64 e 6to4): proibido se o IPv4 embutido for.
// O terceiro valor é o deslocamento do IPv4 a partir da direita.
const IPV6_EMBEDDED: readonly (readonly [string, number, number])[] = [
  ["::ffff:0:0", 96, 0],
  ["64:ff9b::", 96, 0],
  ["2002::", 16, 80],
];

export function parseIPv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

export function parseIPv6(text: string): bigint | null {
  // O DNS pode devolver o escopo (`fe80::1%eth0`): a faixa não depende dele.
  let address = text.split("%")[0] ?? "";
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const ipv4 = parseIPv4(tail);
    if (ipv4 === null) return null;
    address = `${address.slice(0, lastColon + 1)}${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  let value = 0n;
  for (const group of [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest]) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

const toRanges = (ranges: readonly Range[], parse: (text: string) => bigint | null) =>
  ranges.map(([network, prefix]) => ({ network: parse(network)!, prefix }));

const ipv4Ranges = toRanges(IPV4_BLOCKED, parseIPv4);
const ipv6Ranges = toRanges(IPV6_BLOCKED, parseIPv6);
const ipv6Embedded = IPV6_EMBEDDED.map(([network, prefix, shift]) => ({
  network: parseIPv6(network)!,
  prefix,
  shift: BigInt(shift),
}));

const inRange = (value: bigint, network: bigint, prefix: number, bits: number) => {
  const shift = BigInt(bits - prefix);
  return value >> shift === network >> shift;
};

const ipv4Blocked = (value: bigint) =>
  ipv4Ranges.some(({ network, prefix }) => inRange(value, network, prefix, 32));

// Endereço que não interpreta é tratado como proibido: a checagem falha fechada.
export function isBlockedIp(ip: string): boolean {
  const address = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const family = isIP(address.split("%")[0] ?? "");
  if (family === 4) {
    const value = parseIPv4(address);
    return value === null || ipv4Blocked(value);
  }
  if (family === 6) {
    const value = parseIPv6(address);
    if (value === null) return true;
    return (
      ipv6Ranges.some(({ network, prefix }) => inRange(value, network, prefix, 128)) ||
      ipv6Embedded.some(
        ({ network, prefix, shift }) =>
          inRange(value, network, prefix, 128) && ipv4Blocked((value >> shift) & 0xffffffffn),
      )
    );
  }
  return true;
}
