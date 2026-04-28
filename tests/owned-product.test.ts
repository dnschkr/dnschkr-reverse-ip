import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMaybeSingle = vi.fn();
const chain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gt: vi.fn().mockReturnThis(),
  filter: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: mockMaybeSingle,
};
const mockFrom = vi.fn(() => chain);

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

import { findOwnedPurchase } from '@/lib/owned-product.js';

beforeEach(() => {
  vi.clearAllMocks();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.gt.mockReturnThis();
  chain.filter.mockReturnThis();
  chain.order.mockReturnThis();
  chain.limit.mockReturnThis();
});

describe('findOwnedPurchase', () => {
  it('returns null when userId is null (anonymous)', async () => {
    const result = await findOwnedPurchase({
      userId: null,
      ip: '1.2.3.4',
      productId: 'reverse-ip-domain-check-export',
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'srk',
    });
    expect(result).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns mapped purchase summary when an active ready purchase exists', async () => {
    const futureUrlExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'purchase-uuid',
        created_at: '2026-04-01T00:00:00Z',
        access_expires_at: '2027-04-01T00:00:00Z',
        url_expires_at: futureUrlExpiry,
        download_csv_url: 'https://s3/csv',
        download_jsonl_url: 'https://s3/jsonl',
        download_manifest_url: 'https://s3/manifest',
      },
      error: null,
    });
    const result = await findOwnedPurchase({
      userId: 'user-uuid',
      ip: '1.2.3.4',
      productId: 'reverse-ip-domain-check-export',
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'srk',
    });
    expect(result).not.toBeNull();
    expect(result!.purchase_id).toBe('purchase-uuid');
    expect(result!.download_csv_url).toBe('https://s3/csv');
    expect(result!.needs_url_regeneration).toBe(false);
  });

  it('returns null when no matching purchase found', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const result = await findOwnedPurchase({
      userId: 'user-uuid',
      ip: '1.2.3.4',
      productId: 'reverse-ip-domain-check-export',
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'srk',
    });
    expect(result).toBeNull();
  });

  it('flags needs_url_regeneration when url_expires_at is within 24h', async () => {
    const soon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'p',
        created_at: '2026-04-01T00:00:00Z',
        access_expires_at: '2027-04-01T00:00:00Z',
        url_expires_at: soon,
        download_csv_url: 'https://s3/csv',
        download_jsonl_url: 'https://s3/jsonl',
        download_manifest_url: 'https://s3/manifest',
      },
      error: null,
    });
    const result = await findOwnedPurchase({
      userId: 'user-uuid',
      ip: '1.2.3.4',
      productId: 'reverse-ip-domain-check-export',
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'srk',
    });
    expect(result!.needs_url_regeneration).toBe(true);
  });
});
