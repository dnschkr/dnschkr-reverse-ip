import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { rateLimitPerIp, _resetBucketsForTesting } from '@/lib/rate-limit';

beforeEach(() => {
  _resetBucketsForTesting();
});

describe('rateLimitPerIp', () => {
  it('allows up to N requests then 429s', async () => {
    const app = new Hono();
    app.use('*', rateLimitPerIp({ requestsPerMinute: 3 }));
    app.get('/', (c) => c.text('ok'));

    const headers = { 'cf-connecting-ip': '1.2.3.4' };
    const r1 = await app.request('/', { headers });
    const r2 = await app.request('/', { headers });
    const r3 = await app.request('/', { headers });
    const r4 = await app.request('/', { headers });
    expect([r1.status, r2.status, r3.status, r4.status]).toEqual([200, 200, 200, 429]);
  });

  it('separates buckets by IP', async () => {
    const app = new Hono();
    app.use('*', rateLimitPerIp({ requestsPerMinute: 1 }));
    app.get('/', (c) => c.text('ok'));

    const r1 = await app.request('/', { headers: { 'cf-connecting-ip': '1.2.3.4' } });
    const r2 = await app.request('/', { headers: { 'cf-connecting-ip': '5.6.7.8' } });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('falls back to x-forwarded-for when cf-connecting-ip missing', async () => {
    const app = new Hono();
    app.use('*', rateLimitPerIp({ requestsPerMinute: 1 }));
    app.get('/', (c) => c.text('ok'));

    const r1 = await app.request('/', { headers: { 'x-forwarded-for': '9.9.9.9, 8.8.8.8' } });
    const r2 = await app.request('/', { headers: { 'x-forwarded-for': '9.9.9.9, 8.8.8.8' } });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(429);
  });
});
