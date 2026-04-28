import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@clickhouse/client', () => ({
  createClient: () => ({ query: mockQuery }),
}));

import { createReverseIpClient } from '@/clickhouse';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('countHostnamesForIp', () => {
  it('runs the count query with the IP parameter', async () => {
    mockQuery.mockResolvedValueOnce({
      json: async () => ({ data: [{ total: '1542' }] }),
    });
    const client = createReverseIpClient({
      url: 'https://example',
      user: 'tools_ro',
      password: 'pw',
    });
    const total = await client.countHostnamesForIp('1.2.3.4');
    expect(total).toBe(1542);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const arg = mockQuery.mock.calls[0]![0];
    expect(arg.query).toMatch(/count\(\*\)/i);
    expect(arg.query_params).toEqual({ ip: '1.2.3.4' });
  });
});

describe('listHostnamesForIp', () => {
  it('runs the list query with limit parameter and maps *_iso aliases', async () => {
    mockQuery.mockResolvedValueOnce({
      json: async () => ({
        data: [
          {
            hostname: 'example.com',
            record_type: 'A',
            first_seen_iso: '2024-01-01T00:00:00Z',
            last_seen_iso: '2026-04-26T00:00:00Z',
            is_apex: 1,
            tld: 'com',
          },
        ],
      }),
    });
    const client = createReverseIpClient({
      url: 'https://example',
      user: 'tools_ro',
      password: 'pw',
    });
    const rows = await client.listHostnamesForIp('1.2.3.4', 1000);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hostname).toBe('example.com');
    expect(rows[0]!.is_apex).toBe(true);
    expect(rows[0]!.first_seen).toBe('2024-01-01T00:00:00Z');
    expect(rows[0]!.last_seen).toBe('2026-04-26T00:00:00Z');
    const arg = mockQuery.mock.calls[0]![0];
    expect(arg.query_params).toEqual({ ip: '1.2.3.4', limit: 1000 });
  });
});
