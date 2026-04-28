// src/lib/auth.ts
import type { MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';

export function bearerAuth(expectedKey: string): MiddlewareHandler {
  const expectedBuf = Buffer.from(expectedKey);
  return async (c, next) => {
    const auth = c.req.header('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const provided = auth.slice('Bearer '.length);
    const providedBuf = Buffer.from(provided);
    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}
