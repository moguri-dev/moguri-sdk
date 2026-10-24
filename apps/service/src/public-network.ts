import { BlockList, isIP } from "node:net";

const reservedV4 = new BlockList(), reservedV6 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) reservedV4.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96], ["::ffff:0:0", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
  ["2001:db8::", 32], ["2001::", 32], ["2002::", 16],
] as const) reservedV6.addSubnet(address, prefix, "ipv6");
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !reservedV4.check(address, "ipv4") : family === 6 && !reservedV6.check(address, "ipv6");
}
const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const hostname = new RegExp(`^(?:${label}\\.)+${label}$`);
export function canonicalNetworkHostname(value: string): boolean {
  return value.length <= 253 && hostname.test(value) && isIP(value) === 0 && !/^[\d.]+$/.test(value);
}
