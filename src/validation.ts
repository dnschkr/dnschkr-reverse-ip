export function isValidIPv4(input: string): boolean {
  const m = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1, 5).every((octet) => {
    const n = Number(octet);
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === octet;
  });
}

export function isPrivateOrReservedIPv4(input: string): boolean {
  if (!isValidIPv4(input)) return true;
  const parts = input.split('.').map(Number) as [number, number, number, number];
  const a = parts[0];
  const b = parts[1];
  if (a === 0) return true;                            // 0.0.0.0/8 — unspecified
  if (a === 10) return true;                           // 10/8 — RFC 1918
  if (a === 127) return true;                          // 127/8 — loopback
  if (a === 169 && b === 254) return true;             // 169.254/16 — link-local
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16/12 — RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true;   // 100.64/10 — CGNAT
  if (a === 192 && b === 168) return true;             // 192.168/16 — RFC 1918
  if (a >= 224 && a <= 239) return true;               // 224/4 — multicast
  if (a >= 240) return true;                           // 240/4 — reserved + broadcast
  return false;
}

export type ClassifiedInput =
  | { kind: 'ip'; value: string }
  | { kind: 'domain'; value: string }
  | { kind: 'invalid' };

const DOMAIN_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;

export function classifyInput(input: string): ClassifiedInput {
  if (typeof input !== 'string') return { kind: 'invalid' };
  let trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 253) return { kind: 'invalid' };

  // Strip protocol + path.
  trimmed = trimmed.replace(/^https?:\/\//i, '');
  trimmed = trimmed.split('/')[0]!;
  trimmed = trimmed.toLowerCase();

  if (isValidIPv4(trimmed)) return { kind: 'ip', value: trimmed };

  // Domain check: at least one dot + labels valid + total ≤ 253.
  const labels = trimmed.split('.');
  if (labels.length < 2) return { kind: 'invalid' };
  if (labels.some((l) => l.length === 0 || l.length > 63)) {
    return { kind: 'invalid' };
  }
  if (!labels.every((l) => DOMAIN_LABEL_RE.test(l))) return { kind: 'invalid' };
  return { kind: 'domain', value: trimmed };
}
