// src/routes/jobs/generate-export.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { generateExport } from '../../workers/generate-export.js';
import { enqueueGenerateExport } from '../../workers/queue.js';
import type { Config } from '../../config.js';

const Body = z.object({ purchase_id: z.string().uuid() });

export function createGenerateExportRoute(config: Config) {
  const app = new Hono();
  app.post('/jobs/generate-export', zValidator('json', Body), async (c) => {
    const { purchase_id } = c.req.valid('json');
    enqueueGenerateExport(() => generateExport({ purchaseId: purchase_id, config }));
    return c.json({ accepted: true, purchase_id }, 202);
  });
  return app;
}
