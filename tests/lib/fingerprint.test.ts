import { describe, it, expect } from 'vitest';
import {
  computeDownloadToken,
  computeShortOrderId,
  signManifest,
  verifyManifest,
} from '@/lib/fingerprint.js';

const SECRET = 'test-secret-32-bytes-minimum-length-padding';

describe('computeDownloadToken', () => {
  it('produces a 32-char hex token', () => {
    const token = computeDownloadToken(
      {
        stripe_session_id: 'cs_test_abc123',
        email: 'buyer@example.com',
        content_key: 'ip:1.2.3.4',
        generated_at: '2026-04-27T00:00:00.000Z',
      },
      SECRET,
    );
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for identical inputs', () => {
    const inputs = {
      stripe_session_id: 'cs_test_abc',
      email: 'buyer@example.com',
      content_key: 'ip:1.2.3.4',
      generated_at: '2026-04-27T00:00:00.000Z',
    };
    expect(computeDownloadToken(inputs, SECRET)).toBe(
      computeDownloadToken(inputs, SECRET),
    );
  });

  it('changes when any input changes', () => {
    const base = {
      stripe_session_id: 'cs_test_abc',
      email: 'buyer@example.com',
      content_key: 'ip:1.2.3.4',
      generated_at: '2026-04-27T00:00:00.000Z',
    };
    const baseToken = computeDownloadToken(base, SECRET);
    expect(
      computeDownloadToken({ ...base, email: 'other@example.com' }, SECRET),
    ).not.toBe(baseToken);
  });
});

describe('computeShortOrderId', () => {
  it('returns first 8 hex chars of SHA-256(stripe_session_id)', () => {
    const result = computeShortOrderId('cs_test_abc123');
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('signManifest / verifyManifest', () => {
  const manifest = {
    order_id: 'abc-123',
    buyer_fingerprint: 'deadbeef'.repeat(4),
    issued_at: '2026-04-27T00:00:00.000Z',
    tool: 'reverse-ip-domain-check-export',
    content_key: 'ip:1.2.3.4',
    count: 1542,
    csv_sha256: '0'.repeat(64),
    jsonl_sha256: '0'.repeat(64),
  };

  it('signs and verifies a manifest payload', () => {
    const signature = signManifest(manifest, SECRET);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyManifest(manifest, signature, SECRET)).toBe(true);
  });

  it('rejects a tampered manifest', () => {
    const signature = signManifest(manifest, SECRET);
    expect(verifyManifest({ ...manifest, count: 9999 }, signature, SECRET)).toBe(false);
  });
});
