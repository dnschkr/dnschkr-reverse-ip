// tests/config.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '@/config';

describe('loadConfig', () => {
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
    for (const k of Object.keys(VALID_ENV)) delete process.env[k];
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_NOTIFICATION;
  });

  it('loads valid env into a typed config', () => {
    Object.assign(process.env, VALID_ENV);
    const config = loadConfig();
    expect(config.port).toBe(3300);
    expect(config.clickhouse.url).toBe('https://echo-query.dnschkr.com');
    expect(config.clickhouse.user).toBe('tools_ro');
    expect(config.apiKey).toHaveLength(32);
    expect(config.ipService.url).toBe('https://ip.dnschkr.com');
    expect(config.download.fingerprintSecret).toHaveLength(40);
    expect(config.download.s3Bucket).toBe('dnschkr-data-571471188499');
    expect(config.download.sesFrom).toBe('downloads@dnschkr.com');
    expect(config.supabase.url).toBe('https://example.supabase.co');
    expect(config.telegram.enabled).toBe(false);
  });

  it('throws when API_KEY is too short', () => {
    Object.assign(process.env, { ...VALID_ENV, API_KEY: 'short' });
    expect(() => loadConfig()).toThrow(/API_KEY/i);
  });

  it('throws when DOWNLOAD_FINGERPRINT_SECRET is missing', () => {
    const env = { ...VALID_ENV };
    delete (env as any).DOWNLOAD_FINGERPRINT_SECRET;
    Object.assign(process.env, env);
    expect(() => loadConfig()).toThrow(/DOWNLOAD_FINGERPRINT_SECRET/);
  });

  it('throws when DOWNLOAD_FINGERPRINT_SECRET is too short', () => {
    Object.assign(process.env, { ...VALID_ENV, DOWNLOAD_FINGERPRINT_SECRET: 'short' });
    expect(() => loadConfig()).toThrow(/DOWNLOAD_FINGERPRINT_SECRET/i);
  });

  it('throws when CLICKHOUSE_URL is not a valid URL', () => {
    Object.assign(process.env, { ...VALID_ENV, CLICKHOUSE_URL: 'not-a-url' });
    expect(() => loadConfig()).toThrow(/CLICKHOUSE_URL/i);
  });

  it('uses default PORT 3300 when not set', () => {
    const env = { ...VALID_ENV };
    delete (env as any).PORT;
    Object.assign(process.env, env);
    const config = loadConfig();
    expect(config.port).toBe(3300);
  });

  it('parses TELEGRAM_NOTIFICATION=TRUE as enabled=true', () => {
    Object.assign(process.env, { ...VALID_ENV, TELEGRAM_NOTIFICATION: 'TRUE' });
    const config = loadConfig();
    expect(config.telegram.enabled).toBe(true);
  });

  it('treats TELEGRAM_NOTIFICATION=FALSE as enabled=false', () => {
    Object.assign(process.env, { ...VALID_ENV, TELEGRAM_NOTIFICATION: 'FALSE' });
    const config = loadConfig();
    expect(config.telegram.enabled).toBe(false);
  });
});
