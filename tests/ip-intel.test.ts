import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { fetchIpIntel } from '@/ip-intel';

beforeEach(() => fetchMock.mockReset());

describe('fetchIpIntel', () => {
  it('returns mapped intel on success', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          asn: 'AS13335',
          asn_org: 'Cloudflare, Inc.',
          country: 'US',
          city: 'San Francisco',
          is_cdn: true,
          threats: [],
        }),
        { status: 200 },
      ),
    );
    const result = await fetchIpIntel({
      ip: '1.1.1.1',
      serviceUrl: 'https://ip.dnschkr.com',
      apiKey: 'k',
    });
    expect(result.asn).toBe('AS13335 Cloudflare, Inc.');
    expect(result.is_cdn).toBe(true);
  });

  it('returns null intel on 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('err', { status: 500 }));
    const result = await fetchIpIntel({
      ip: '1.1.1.1',
      serviceUrl: 'https://ip.dnschkr.com',
      apiKey: 'k',
    });
    expect(result).toBeNull();
  });

  it('times out after 5s and returns null', async () => {
    fetchMock.mockImplementationOnce(() =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 100),
      ),
    );
    const result = await fetchIpIntel({
      ip: '1.1.1.1',
      serviceUrl: 'https://ip.dnschkr.com',
      apiKey: 'k',
      timeoutMs: 50,
    });
    expect(result).toBeNull();
  });
});
