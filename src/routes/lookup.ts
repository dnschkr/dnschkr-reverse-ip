// src/routes/lookup.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Config } from '../config.js';
import { classifyInput, isPrivateOrReservedIPv4 } from '../validation.js';
import { resolveDomain } from '../resolve.js';
import { createReverseIpClient } from '../clickhouse.js';
import { fetchIpIntel } from '../ip-intel.js';
import { findOwnedPurchase } from '../lib/owned-product.js';

const OVER_THRESHOLD = 10_000;
const PRODUCT_ID = 'reverse-ip-domain-check-export'; // kebab-case — matches Plan A seed

const lookupSchema = z.object({
  input: z.string().min(1).max(253),
  tier_cap: z.number().int().min(50).max(5000),
  // Narrow the result list to one TLD. The visible list is capped well below
  // the total for busy IPs, so this is how a caller reaches the rows the cap
  // would otherwise hide.
  tld: z
    .string()
    .max(63)
    .regex(/^[a-z0-9-]*$/i)
    .optional(),
});

export function createLookupRoute(config: Config) {
  const app = new Hono();
  const ch = createReverseIpClient(config.clickhouse);

  app.post('/lookup', zValidator('json', lookupSchema), async (c) => {
    const { input, tier_cap, tld } = c.req.valid('json');
    const userId = c.req.header('x-user-id') ?? null;

    const classified = classifyInput(input);
    if (classified.kind === 'invalid') {
      return c.json({ error: 'invalid_input' }, 400);
    }

    let ip: string;
    let inputMeta: { raw: string; type: 'ip' | 'domain'; resolved_ip: string };
    if (classified.kind === 'ip') {
      if (isPrivateOrReservedIPv4(classified.value)) {
        return c.json({ error: 'private_or_reserved_ip' }, 400);
      }
      ip = classified.value;
      inputMeta = { raw: input, type: 'ip', resolved_ip: ip };
    } else {
      const r = await resolveDomain(classified.value);
      if (!r.ok) {
        if (r.reason === 'private_ip') {
          return c.json({ error: 'private_or_reserved_ip' }, 400);
        }
        return c.json({ error: 'domain_unresolvable' }, 400);
      }
      ip = r.ip;
      inputMeta = { raw: input, type: 'domain', resolved_ip: ip };
    }

    const [summary, ipIntel, existingPurchase] = await Promise.all([
      ch.summarizeIp(ip),
      fetchIpIntel({
        ip,
        serviceUrl: config.ipService.url,
        apiKey: config.ipService.apiKey,
      }),
      findOwnedPurchase({
        userId,
        ip,
        productId: PRODUCT_ID,
        supabaseUrl: config.supabase.url,
        supabaseServiceRoleKey: config.supabase.serviceRoleKey,
      }),
    ]);

    const { total, latest_scan, tlds } = summary;
    const priceTier = computePriceTier(total);

    if (total > OVER_THRESHOLD) {
      return c.json({
        input: inputMeta,
        ip,
        ip_intel: ipIntel,
        count: { total, displayed: 0, tier_cap, over_threshold: true, filtered_tld: null },
        tlds,
        results: null,
        bulk_export_offer: {
          available: true,
          total,
          price_usd: priceTier.price_usd,
          tier: priceTier.tier,
        },
        existing_purchase: existingPurchase,
        meta: {
          credit_charged: false,
          freshness: { scan_window_days: 7, latest_scan },
        },
      });
    }

    // When a TLD filter is applied the cap applies to that slice, so the limit
    // is the tier cap rather than min(cap, total-across-all-TLDs).
    const limit = tld ? tier_cap : Math.min(tier_cap, total);
    const rows = await ch.listHostnamesForIp(ip, limit, tld ?? null);

    return c.json({
      input: inputMeta,
      ip,
      ip_intel: ipIntel,
      count: {
        total,
        displayed: rows.length,
        tier_cap,
        over_threshold: false,
        filtered_tld: tld ?? null,
      },
      tlds,
      results: rows,
      bulk_export_offer: {
        available: total > tier_cap,
        total,
        price_usd: priceTier.price_usd,
        tier: priceTier.tier,
      },
      existing_purchase: existingPurchase,
      meta: {
        credit_charged: true,
        freshness: { scan_window_days: 7, latest_scan },
      },
    });
  });

  return app;
}

function computePriceTier(count: number): { price_usd: number; tier: string } {
  if (count <= 50_000) return { price_usd: 19, tier: 'up_to_50k' };
  if (count <= 250_000) return { price_usd: 99, tier: '50k_to_250k' };
  if (count <= 1_000_000) return { price_usd: 299, tier: '250k_to_1m' };
  return { price_usd: 999, tier: 'over_1m' };
}
