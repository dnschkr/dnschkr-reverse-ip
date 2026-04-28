// SHARED-WITH: dnschkr-site lib/downloads/{fingerprint,file-writer}.ts
// Keep in lockstep — file format / HMAC contract must match exactly.
// Last synced: 2026-04-28
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface DownloadTokenInputs {
  stripe_session_id: string;
  email: string;
  content_key: string; // e.g. 'ip:1.2.3.4' for reverse IP
  generated_at: string; // ISO 8601
}

export function computeDownloadToken(
  inputs: DownloadTokenInputs,
  secret: string,
): string {
  if (!secret || secret.length < 32) {
    throw new Error('DOWNLOAD_FINGERPRINT_SECRET must be at least 32 bytes');
  }
  const payload = [
    inputs.stripe_session_id,
    inputs.email,
    inputs.content_key,
    inputs.generated_at,
  ].join('|');
  const full = createHmac('sha256', secret).update(payload).digest('hex');
  return full.slice(0, 32);
}

export function computeShortOrderId(stripeSessionId: string): string {
  return createHash('sha256')
    .update(stripeSessionId)
    .digest('hex')
    .slice(0, 8);
}

export interface ManifestPayload {
  order_id: string;
  buyer_fingerprint: string;
  issued_at: string;
  tool: string;
  content_key: string;
  count: number;
  csv_sha256: string;
  jsonl_sha256: string;
}

function canonicalManifest(manifest: ManifestPayload): string {
  // Stable serialization — sort keys alphabetically.
  const keys = Object.keys(manifest).sort() as (keyof ManifestPayload)[];
  return keys.map((k) => `${k}=${manifest[k]}`).join('\n');
}

export function signManifest(
  manifest: ManifestPayload,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(canonicalManifest(manifest))
    .digest('hex');
}

export function verifyManifest(
  manifest: ManifestPayload,
  signature: string,
  secret: string,
): boolean {
  const expected = signManifest(manifest, secret);
  // Both must be the same length to use timingSafeEqual.
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex'),
  );
}
