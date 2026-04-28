import type { MiddlewareHandler } from 'hono';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
let lastPruneAt = Date.now();

function extractIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

export function rateLimitPerIp(opts: { requestsPerMinute: number }): MiddlewareHandler {
  const refillRatePerMs = opts.requestsPerMinute / 60_000;
  const capacity = opts.requestsPerMinute;

  return async (c, next) => {
    const ip = extractIp(c.req.raw.headers);
    const now = Date.now();

    if (now - lastPruneAt > PRUNE_INTERVAL_MS) {
      for (const [k, b] of buckets) {
        if (now - b.lastRefill > PRUNE_INTERVAL_MS) buckets.delete(k);
      }
      lastPruneAt = now;
    }

    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      buckets.set(ip, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRatePerMs);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    bucket.tokens -= 1;
    await next();
  };
}

// Test helper — clears the global bucket map so tests are isolated.
export function _resetBucketsForTesting(): void {
  buckets.clear();
  lastPruneAt = Date.now();
}
