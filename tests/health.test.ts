// tests/health.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '@/index';

const VALID_ENV = {
  PORT: '3300',
  API_KEY: 'a'.repeat(32),
  CLICKHOUSE_URL: 'https://echo-query.dnschkr.com',
  CLICKHOUSE_USER: 'tools_ro',
  CLICKHOUSE_PASSWORD: 'pw',
  IP_SERVICE_URL: 'https://ip.dnschkr.com',
  IP_SERVICE_API_KEY: 'k'.repeat(20),
  DOWNLOAD_FINGERPRINT_SECRET: 'b'.repeat(40),
  S3_DOWNLOADS_BUCKET: 'dnschkr-data-571471188499',
  S3_DOWNLOADS_REGION: 'us-east-1',
  AWS_SES_FROM_DOWNLOADS: 'downloads@dnschkr.com',
  AWS_ACCESS_KEY_ID: 'AKIA_test',
  AWS_SECRET_ACCESS_KEY: 'secret_test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'srk_test',
};

beforeEach(() => {
  Object.assign(process.env, VALID_ENV);
});

describe('GET /health', () => {
  it('returns 200 with { ok: true, service: "reverse-ip" }', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, service: 'reverse-ip' });
  });

  it('does not require auth on /health', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
