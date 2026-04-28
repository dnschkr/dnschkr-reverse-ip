// src/index.ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { healthRoute } from './routes/health.js';
import { createLookupRoute } from './routes/lookup.js';
import { bearerAuth } from './lib/auth.js';
import { loadConfig } from './config.js';

export function createApp() {
  const config = loadConfig();
  const app = new Hono();
  app.use('*', logger());
  app.route('/', healthRoute);
  app.use('/lookup', bearerAuth(config.apiKey));
  app.route('/', createLookupRoute(config));
  return app;
}

// Only start the server when this file is the entrypoint (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const app = createApp();
  serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
    console.log(`reverse-ip listening on :${port}`);
  });
}
