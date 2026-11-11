import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";

export const USERNAME_PATTERN = /^[A-Za-z0-9_.@+-]{1,128}$/;

export function parseTrustedProxies(value: string): BlockList {
  const proxies = new BlockList();
  for (const item of value.split(",")) {
    const [address = "", prefix, ...extra] = item.trim().split("/");
    const version = isIP(address);
    if (!version || address.includes("%") || extra.length) throw new Error("invalid IP or CIDR");
    const family = version === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) proxies.addAddress(address, family);
    else {
      if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)) {
        throw new Error("invalid CIDR prefix");
      }
      proxies.addSubnet(address, Number(prefix), family);
    }
  }
  return proxies;
}

/** Null is single-user mode. Undefined means authentication failed. */
export function proxyUsername(request: IncomingMessage, proxies: BlockList | null): string | null | undefined {
  if (!proxies) return null;
  const address = request.socket.remoteAddress;
  if (!address || !proxies.check(address, isIP(address) === 6 ? "ipv6" : "ipv4")) return undefined;
  const values = request.headersDistinct["x-forwarded-user"];
  const username = values?.[0];
  return values?.length === 1 && username && USERNAME_PATTERN.test(username) ? username : undefined;
}

/** Browser writes and WebSocket upgrades must originate at the app's own URL. */
export function validRequestOrigin(request: IncomingMessage, baseUrl: string): boolean {
  const origin = request.headers.origin;
  return origin === undefined || origin === new URL(baseUrl).origin;
}
