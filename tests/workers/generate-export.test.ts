import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '@/config.js';

// ─── Supabase fluent mock ─────────────────────────────────────────────────
const mockSingle = vi.fn();
const mockUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null });
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const fromChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: mockSingle,
  update: vi.fn().mockReturnValue({ eq: mockUpdateEq }),
  insert: mockInsert,
};
const mockFrom = vi.fn(() => fromChain);
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

// ─── ClickHouse client mock ───────────────────────────────────────────────
const mockListHostnamesForIp = vi.fn();
vi.mock('@/clickhouse.js', () => ({
  createReverseIpClient: vi.fn(() => ({
    listHostnamesForIp: mockListHostnamesForIp,
    countHostnamesForIp: vi.fn(),
  })),
}));

// ─── AWS S3 mocks ─────────────────────────────────────────────────────────
const s3SendMock = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: s3SendMock })),
  PutObjectCommand: vi.fn((args) => ({ __cmd: 'Put', args })),
  GetObjectCommand: vi.fn((args) => ({ __cmd: 'Get', args })),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockImplementation(async (_client, cmd) => {
    return `https://s3.example.com/presigned/${cmd.args.Key}`;
  }),
}));

// ─── AWS SES mock ─────────────────────────────────────────────────────────
const sesSendMock = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn(() => ({ send: sesSendMock })),
  SendEmailCommand: vi.fn((args) => ({ __cmd: 'SendEmail', args })),
}));

import { generateExport } from '@/workers/generate-export.js';

const baseConfig: Config = {
  port: 3300,
  apiKey: 'k'.repeat(32),
  clickhouse: { url: 'http://ch', user: 'u', password: 'p' },
  ipService: { url: 'http://ip', apiKey: 'x' },
  download: {
    fingerprintSecret: 's'.repeat(40),
    s3Bucket: 'test-bucket',
    s3Region: 'us-east-1',
    sesFrom: 'no-reply@dnschkr.com',
  },
  aws: { accessKeyId: 'AKIA', secretAccessKey: 'SECRET' },
  supabase: { url: 'https://example.supabase.co', serviceRoleKey: 'srk' },
  telegram: { enabled: false },
};

const validPurchase = {
  id: 'purchase-uuid-123',
  product_id: 'reverse-ip-domain-check-export',
  stripe_session_id: 'cs_test_abc',
  email: 'buyer@example.com',
  status: 'paid',
  download_token: 'd'.repeat(32),
  short_order_id: '12345678',
  product_metadata: { ip: '1.2.3.4' },
  created_at: '2026-04-27T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  fromChain.select.mockReturnThis();
  fromChain.eq.mockReturnThis();
  fromChain.update.mockReturnValue({ eq: mockUpdateEq });
  mockUpdateEq.mockResolvedValue({ data: null, error: null });
  mockInsert.mockResolvedValue({ data: null, error: null });
});

describe('generateExport — happy path', () => {
  it('marks ready with all download URLs and S3 keys, uploads 3 files, sends 1 email', async () => {
    mockSingle.mockResolvedValueOnce({ data: validPurchase, error: null });
    mockListHostnamesForIp.mockResolvedValueOnce([
      { hostname: 'example.com', record_type: 'A', first_seen: '2024-01-01', last_seen: '2026-04-26', is_apex: true, tld: 'com' },
      { hostname: 'mail.example.com', record_type: 'A', first_seen: '2024-02-01', last_seen: '2026-04-26', is_apex: false, tld: 'com' },
    ]);

    await generateExport({ purchaseId: validPurchase.id, config: baseConfig });

    // 3 S3 PutObject + 0 GetObject (GetObject is constructed but not sent — getSignedUrl uses it)
    expect(s3SendMock).toHaveBeenCalledTimes(3);
    expect(sesSendMock).toHaveBeenCalledTimes(1);

    // First update: status -> processing
    // Subsequent update: status -> ready with all the artifacts
    const updateCalls = fromChain.update.mock.calls;
    const readyCall = updateCalls.find(
      (call) => (call[0] as Record<string, unknown>).status === 'ready',
    );
    expect(readyCall).toBeDefined();
    const readyPayload = readyCall![0] as Record<string, unknown>;
    expect(readyPayload).toMatchObject({
      status: 'ready',
      s3_csv_key: expect.stringContaining('purchases/'),
      s3_jsonl_key: expect.stringContaining('purchases/'),
      s3_manifest_key: expect.stringContaining('purchases/'),
      download_csv_url: expect.stringContaining('https://s3.example.com/presigned/'),
      download_jsonl_url: expect.stringContaining('https://s3.example.com/presigned/'),
      download_manifest_url: expect.stringContaining('https://s3.example.com/presigned/'),
    });
    expect(readyPayload.url_expires_at).toBeTruthy();
    expect(readyPayload.ready_at).toBeTruthy();

    // Audit event logged
    const insertCalls = mockInsert.mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    const successEvent = insertCalls.find((c) => {
      const arg = c[0] as { metadata?: { to?: string } };
      return arg.metadata?.to === 'ready';
    });
    expect(successEvent).toBeDefined();
  });
});

describe('generateExport — failure paths', () => {
  it('marks failed and rethrows when ClickHouse query rejects', async () => {
    mockSingle.mockResolvedValueOnce({ data: validPurchase, error: null });
    mockListHostnamesForIp.mockRejectedValueOnce(new Error('clickhouse down'));

    await expect(
      generateExport({ purchaseId: validPurchase.id, config: baseConfig }),
    ).rejects.toThrow('clickhouse down');

    const updateCalls = fromChain.update.mock.calls;
    const failedCall = updateCalls.find(
      (call) => (call[0] as Record<string, unknown>).status === 'failed',
    );
    expect(failedCall).toBeDefined();

    // Audit event records the error
    const failureEvent = mockInsert.mock.calls.find((c) => {
      const arg = c[0] as { metadata?: { error?: string } };
      return arg.metadata?.error === 'clickhouse down';
    });
    expect(failureEvent).toBeDefined();
  });

  it('marks failed and rethrows when S3 upload rejects', async () => {
    mockSingle.mockResolvedValueOnce({ data: validPurchase, error: null });
    mockListHostnamesForIp.mockResolvedValueOnce([
      { hostname: 'example.com', record_type: 'A', first_seen: '2024-01-01', last_seen: '2026-04-26', is_apex: true, tld: 'com' },
    ]);
    s3SendMock.mockRejectedValueOnce(new Error('s3 unavailable'));

    await expect(
      generateExport({ purchaseId: validPurchase.id, config: baseConfig }),
    ).rejects.toThrow('s3 unavailable');

    const failedCall = fromChain.update.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).status === 'failed',
    );
    expect(failedCall).toBeDefined();
  });

  it('throws when purchase row is missing', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    await expect(
      generateExport({ purchaseId: 'missing', config: baseConfig }),
    ).rejects.toThrow(/not found/);
  });

  it('skips when purchase is already ready (idempotency)', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { ...validPurchase, status: 'ready' },
      error: null,
    });

    await generateExport({ purchaseId: validPurchase.id, config: baseConfig });

    expect(s3SendMock).not.toHaveBeenCalled();
    expect(sesSendMock).not.toHaveBeenCalled();
    expect(mockListHostnamesForIp).not.toHaveBeenCalled();
  });
});
