// SHARED-WITH: dnschkr-site lib/downloads/{fingerprint,file-writer}.ts
// Keep in lockstep — file format / HMAC contract must match exactly.
// Last synced: 2026-04-28
import { createHash } from 'node:crypto';
import {
  signManifest,
  type ManifestPayload,
} from './fingerprint.js';

export interface FingerprintMeta {
  short_order_id: string;
  download_token: string;
  issued_at: string; // ISO 8601
  product_id: string;
  content_key: string; // e.g. 'ip:1.2.3.4'
}

export interface FileWriterInputs<TRow extends Record<string, unknown>> {
  fingerprintMeta: FingerprintMeta;
  columns: (keyof TRow & string)[];
  rows: TRow[];
}

export function writeCsvWithHeader<TRow extends Record<string, unknown>>(
  input: FileWriterInputs<TRow>,
): string {
  const { fingerprintMeta, columns, rows } = input;
  const headerComment = `# DNS Checker bulk export · Order ${fingerprintMeta.short_order_id} · Buyer fingerprint ${fingerprintMeta.download_token} · Issued ${fingerprintMeta.issued_at} · Tool ${fingerprintMeta.product_id} · Content ${fingerprintMeta.content_key}`;
  const columnHeader = columns.join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => csvEscape(row[c])).join(','),
  );
  return [headerComment, columnHeader, ...dataLines].join('\n');
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function writeJsonlWithMeta<TRow extends Record<string, unknown>>(input: {
  fingerprintMeta: FingerprintMeta;
  rows: TRow[];
}): string {
  const { fingerprintMeta, rows } = input;
  const meta = {
    _meta: {
      order: fingerprintMeta.short_order_id,
      buyer_fingerprint: fingerprintMeta.download_token,
      issued_at: fingerprintMeta.issued_at,
      tool: fingerprintMeta.product_id,
      content: fingerprintMeta.content_key,
      note:
        'First line of this file is metadata. Skip line 1 when ingesting raw data.',
    },
  };
  const lines = [JSON.stringify(meta), ...rows.map((r) => JSON.stringify(r))];
  return lines.join('\n');
}

export interface ManifestBuildResult {
  payload: ManifestPayload;
  signature: string;
  serialized: string;
}

export function buildManifest(input: {
  fingerprintMeta: FingerprintMeta;
  count: number;
  csv: string;
  jsonl: string;
  secret: string;
}): ManifestBuildResult {
  const csv_sha256 = createHash('sha256').update(input.csv).digest('hex');
  const jsonl_sha256 = createHash('sha256').update(input.jsonl).digest('hex');
  const payload: ManifestPayload = {
    order_id: input.fingerprintMeta.short_order_id,
    buyer_fingerprint: input.fingerprintMeta.download_token,
    issued_at: input.fingerprintMeta.issued_at,
    tool: input.fingerprintMeta.product_id,
    content_key: input.fingerprintMeta.content_key,
    count: input.count,
    csv_sha256,
    jsonl_sha256,
  };
  const signature = signManifest(payload, input.secret);
  const serialized = JSON.stringify(
    { ...payload, signature, _signature_algorithm: 'HMAC-SHA256' },
    null,
    2,
  );
  return { payload, signature, serialized };
}
