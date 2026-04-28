import { describe, it, expect } from 'vitest';
import {
  writeCsvWithHeader,
  writeJsonlWithMeta,
  buildManifest,
} from '@/lib/file-writer.js';
import { verifyManifest } from '@/lib/fingerprint.js';

const SECRET = 'a'.repeat(40);
const fingerprintMeta = {
  short_order_id: '12345678',
  download_token: 'b'.repeat(32),
  issued_at: '2026-04-27T00:00:00.000Z',
  product_id: 'reverse-ip-domain-check-export',
  content_key: 'ip:1.2.3.4',
};
const rows = [
  { hostname: 'example.com', record_type: 'A', is_apex: true, first_seen: '2024-01-01', last_seen: '2026-04-26', tld: 'com' },
  { hostname: 'mail.example.com', record_type: 'A', is_apex: false, first_seen: '2024-02-01', last_seen: '2026-04-26', tld: 'com' },
];
const columns = ['hostname', 'record_type', 'is_apex', 'first_seen', 'last_seen', 'tld'];

describe('writeCsvWithHeader', () => {
  it('starts with a comment row containing the fingerprint', () => {
    const csv = writeCsvWithHeader({ fingerprintMeta, columns, rows });
    const lines = csv.split('\n');
    expect(lines[0]).toMatch(/^# DNS Checker bulk export/);
    expect(lines[0]).toContain(fingerprintMeta.short_order_id);
    expect(lines[0]).toContain(fingerprintMeta.download_token);
    expect(lines[0]).toContain(fingerprintMeta.issued_at);
    expect(lines[0]).toContain(fingerprintMeta.product_id);
  });

  it('has the column header as second row and data rows after', () => {
    const csv = writeCsvWithHeader({ fingerprintMeta, columns, rows });
    const lines = csv.split('\n');
    expect(lines[1]).toBe('hostname,record_type,is_apex,first_seen,last_seen,tld');
    expect(lines[2]).toBe('example.com,A,true,2024-01-01,2026-04-26,com');
    expect(lines[3]).toBe('mail.example.com,A,false,2024-02-01,2026-04-26,com');
  });

  it('escapes commas in cells', () => {
    const tricky = [{ hostname: 'a,b.example.com', record_type: 'TXT', is_apex: false, first_seen: '2024', last_seen: '2026', tld: 'com' }];
    const csv = writeCsvWithHeader({ fingerprintMeta, columns, rows: tricky });
    expect(csv).toContain('"a,b.example.com"');
  });
});

describe('writeJsonlWithMeta', () => {
  it('first line is _meta object, subsequent lines are rows', () => {
    const jsonl = writeJsonlWithMeta({ fingerprintMeta, rows });
    const lines = jsonl.split('\n').filter(Boolean);
    const meta = JSON.parse(lines[0]!);
    expect(meta._meta.order).toBe(fingerprintMeta.short_order_id);
    expect(meta._meta.tool).toBe(fingerprintMeta.product_id);
    expect(JSON.parse(lines[1]!).hostname).toBe('example.com');
    expect(JSON.parse(lines[2]!).hostname).toBe('mail.example.com');
  });
});

describe('buildManifest', () => {
  it('contains SHA-256 hashes and a verifiable signature', () => {
    const csv = writeCsvWithHeader({ fingerprintMeta, columns, rows });
    const jsonl = writeJsonlWithMeta({ fingerprintMeta, rows });
    const manifest = buildManifest({
      fingerprintMeta,
      count: rows.length,
      csv,
      jsonl,
      secret: SECRET,
    });
    expect(manifest.payload.csv_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.payload.jsonl_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyManifest(manifest.payload, manifest.signature, SECRET)).toBe(true);
  });
});
