import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — define fns inside factories, then re-export via module-level vars
vi.mock('@/clickhouse', () => ({
  createReverseIpClient: () => ({
    countHostnamesForIp: (...args: unknown[]) => mockClickhouse.countHostnamesForIp(...args),
    listHostnamesForIp: (...args: unknown[]) => mockClickhouse.listHostnamesForIp(...args),
  }),
}));
vi.mock('@/ip-intel', () => ({
  fetchIpIntel: (...args: unknown[]) => mockIpIntel(...args),
}));
vi.mock('@/resolve', () => ({
  resolveDomain: (...args: unknown[]) => mockResolve(...args),
}));
vi.mock('@/lib/owned-product', () => ({
  findOwnedPurchase: (...args: unknown[]) => mockOwned(...args),
}));

const mockClickhouse = {
  countHostnamesForIp: vi.fn(),
  listHostnamesForIp: vi.fn(),
};
const mockIpIntel = vi.fn();
const mockResolve = vi.fn();
const mockOwned = vi.fn();

const TEST_KEY = 'a'.repeat(32);
process.env.API_KEY = TEST_KEY;
process.env.CLICKHOUSE_URL = 'https://example';
process.env.CLICKHOUSE_USER = 'tools_ro';
process.env.CLICKHOUSE_PASSWORD = 'pw';
process.env.IP_SERVICE_URL = 'https://ip.dnschkr.com';
process.env.IP_SERVICE_API_KEY = 'k'.repeat(20);
process.env.DOWNLOAD_FINGERPRINT_SECRET = 'd'.repeat(40);
process.env.S3_DOWNLOADS_BUCKET = 'b';
process.env.S3_DOWNLOADS_REGION = 'us-east-1';
process.env.AWS_SES_FROM_DOWNLOADS = 'd@example.com';
process.env.AWS_ACCESS_KEY_ID = 'ak';
process.env.AWS_SECRET_ACCESS_KEY = 'sk';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk';

import { createApp } from '@/index';

beforeEach(() => {
  vi.clearAllMocks();
  mockIpIntel.mockResolvedValue({ asn: 'AS1', country: 'US', city: '', org: '', is_cdn: false, threats: [] });
  mockOwned.mockResolvedValue(null);
});

function authedRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request('http://test/lookup', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TEST_KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /lookup', () => {
  it('returns count + results for valid IP under threshold', async () => {
    mockClickhouse.countHostnamesForIp.mockResolvedValueOnce(1542);
    mockClickhouse.listHostnamesForIp.mockResolvedValueOnce([
      { hostname: 'example.com', record_type: 'A', first_seen: '2024', last_seen: '2026', is_apex: true, tld: 'com' },
    ]);
    const res = await createApp().request(authedRequest({ input: '1.2.3.4', tier_cap: 1000 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count.total).toBe(1542);
    expect(body.count.over_threshold).toBe(false);
    expect(body.results).toHaveLength(1);
    expect(body.meta.credit_charged).toBe(true);
  });

  it('returns no results + no credit when count > 10,000', async () => {
    mockClickhouse.countHostnamesForIp.mockResolvedValueOnce(234567);
    const res = await createApp().request(authedRequest({ input: '104.21.55.12', tier_cap: 1000 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count.over_threshold).toBe(true);
    expect(body.results).toBeNull();
    expect(body.meta.credit_charged).toBe(false);
    expect(body.bulk_export_offer.price_usd).toBe(99); // 234k → 50k_to_250k tier
    expect(mockClickhouse.listHostnamesForIp).not.toHaveBeenCalled();
  });

  it('resolves domain → IP and runs the query', async () => {
    mockResolve.mockResolvedValueOnce({ ok: true, ip: '93.184.216.34' });
    mockClickhouse.countHostnamesForIp.mockResolvedValueOnce(100);
    mockClickhouse.listHostnamesForIp.mockResolvedValueOnce([]);
    const res = await createApp().request(authedRequest({ input: 'example.com', tier_cap: 100 }));
    const body = await res.json();
    expect(body.input.type).toBe('domain');
    expect(body.input.resolved_ip).toBe('93.184.216.34');
    expect(body.ip).toBe('93.184.216.34');
  });

  it('rejects invalid input', async () => {
    const res = await createApp().request(authedRequest({ input: '!!!', tier_cap: 100 }));
    expect(res.status).toBe(400);
  });

  it('rejects private IP', async () => {
    const res = await createApp().request(authedRequest({ input: '10.0.0.1', tier_cap: 100 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/private/i);
  });

  it('returns existing_purchase when user owns active export', async () => {
    mockOwned.mockResolvedValueOnce({
      purchase_id: 'p-1',
      purchased_at: '2026-01-01',
      access_expires_at: '2027-01-01',
      url_expires_at: '2026-05-04',
      download_csv_url: 'https://s3...',
      download_jsonl_url: 'https://s3...',
      download_manifest_url: 'https://s3...',
      needs_url_regeneration: false,
    });
    mockClickhouse.countHostnamesForIp.mockResolvedValueOnce(1542);
    mockClickhouse.listHostnamesForIp.mockResolvedValueOnce([]);
    const res = await createApp().request(
      authedRequest({ input: '1.2.3.4', tier_cap: 1000 }, { 'X-User-Id': 'user-1' })
    );
    const body = await res.json();
    expect(body.existing_purchase).not.toBeNull();
    expect(body.existing_purchase.purchase_id).toBe('p-1');
  });

  // additional edge cases:

  it('returns 401 without Bearer auth', async () => {
    const res = await createApp().request(
      new Request('http://test/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: '1.2.3.4', tier_cap: 100 }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when domain fails to resolve', async () => {
    mockResolve.mockResolvedValueOnce({ ok: false, reason: 'unresolvable' });
    const res = await createApp().request(authedRequest({ input: 'nx.example.invalid', tier_cap: 100 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('domain_unresolvable');
  });

  it('returns 400 when domain resolves to a private IP', async () => {
    mockResolve.mockResolvedValueOnce({ ok: false, reason: 'private_ip' });
    const res = await createApp().request(authedRequest({ input: 'intranet.example.com', tier_cap: 100 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/private/i);
  });

  it('uses computed price tier $19 for total ≤ 50k', async () => {
    mockClickhouse.countHostnamesForIp.mockResolvedValueOnce(40_000);
    mockClickhouse.listHostnamesForIp.mockResolvedValueOnce([]);
    const res = await createApp().request(authedRequest({ input: '1.2.3.4', tier_cap: 1000 }));
    const body = await res.json();
    expect(body.bulk_export_offer.price_usd).toBe(19);
    expect(body.bulk_export_offer.tier).toBe('up_to_50k');
  });

  it('uses computed price tier $999 for total > 1m', async () => {
    mockClickhouse.countHostnamesForIp.mockResolvedValueOnce(1_500_000);
    const res = await createApp().request(authedRequest({ input: '1.2.3.4', tier_cap: 1000 }));
    const body = await res.json();
    expect(body.bulk_export_offer.price_usd).toBe(999);
    expect(body.bulk_export_offer.tier).toBe('over_1m');
  });
});
