// src/routes/health.ts
import { Hono } from 'hono';

export const healthRoute = new Hono();

healthRoute.get('/health', (c) =>
  c.json({ ok: true, service: 'reverse-ip' }),
);
