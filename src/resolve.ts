import { resolve4 } from 'node:dns/promises';
import { isPrivateOrReservedIPv4 } from './validation.js';

export type ResolveResult =
  | { ok: true; ip: string }
  | { ok: false; reason: 'unresolvable' | 'no_a_record' | 'private_ip' };

export async function resolveDomain(domain: string): Promise<ResolveResult> {
  let addresses: string[];
  try {
    addresses = await resolve4(domain);
  } catch (err) {
    return { ok: false, reason: 'unresolvable' };
  }
  if (!addresses || addresses.length === 0) {
    return { ok: false, reason: 'no_a_record' };
  }
  const ip = addresses[0]!;
  if (isPrivateOrReservedIPv4(ip)) {
    return { ok: false, reason: 'private_ip' };
  }
  return { ok: true, ip };
}
