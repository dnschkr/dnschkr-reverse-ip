// tests/auth.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from '@/lib/auth';

const TEST_KEY = 'a'.repeat(32);

function makeApp() {
  const app = new Hono();
  app.use('/protected/*', bearerAuth(TEST_KEY));
  app.get('/protected/ping', (c) => c.text('pong'));
  app.get('/health', (c) => c.text('ok'));
  return app;
}

describe('bearerAuth', () => {
  it('lets through requests with the correct token', async () => {
    const res = await makeApp().request('/protected/ping', {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('pong');
  });

  it('rejects missing Authorization header', async () => {
    const res = await makeApp().request('/protected/ping');
    expect(res.status).toBe(401);
  });

  it('rejects wrong scheme', async () => {
    const res = await makeApp().request('/protected/ping', {
      headers: { Authorization: `Basic ${TEST_KEY}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects wrong token', async () => {
    const res = await makeApp().request('/protected/ping', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects token of different length than expected', async () => {
    const res = await makeApp().request('/protected/ping', {
      headers: { Authorization: 'Bearer short' },
    });
    expect(res.status).toBe(401);
  });

  it('does not gate /health (only /protected/* is gated in this fixture)', async () => {
    const res = await makeApp().request('/health');
    expect(res.status).toBe(200);
  });
});
