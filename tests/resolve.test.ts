import { describe, it, expect, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn(),
}));

import { resolveDomain } from '@/resolve';
import * as dns from 'node:dns/promises';

describe('resolveDomain', () => {
  it('returns the first A record', async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(['93.184.216.34', '1.2.3.4']);
    const result = await resolveDomain('example.com');
    expect(result).toEqual({ ok: true, ip: '93.184.216.34' });
  });

  it('returns ok:false on NXDOMAIN', async () => {
    vi.mocked(dns.resolve4).mockRejectedValueOnce(
      Object.assign(new Error('not found'), { code: 'ENOTFOUND' }),
    );
    const result = await resolveDomain('example.invalid');
    expect(result).toEqual({ ok: false, reason: 'unresolvable' });
  });

  it('returns ok:false on no A records', async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce([]);
    const result = await resolveDomain('example.com');
    expect(result).toEqual({ ok: false, reason: 'no_a_record' });
  });

  it('rejects when resolved IP is private/reserved (SSRF defence)', async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(['10.0.0.1']);
    const result = await resolveDomain('intranet.example.com');
    expect(result).toEqual({ ok: false, reason: 'private_ip' });
  });
});
