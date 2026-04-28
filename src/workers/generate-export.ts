// src/workers/generate-export.ts
import { createClient } from '@supabase/supabase-js';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Config } from '../config.js';
import { createReverseIpClient } from '../clickhouse.js';
import {
  writeCsvWithHeader,
  writeJsonlWithMeta,
  buildManifest,
  type FingerprintMeta,
} from '../lib/file-writer.js';

const PRESIGN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const ROW_LIMIT = 5_000_000;
const COLUMNS = [
  'hostname',
  'record_type',
  'is_apex',
  'first_seen',
  'last_seen',
  'tld',
] as const;

interface PurchaseRow {
  id: string;
  product_id: string;
  stripe_session_id: string;
  email: string;
  status: string;
  download_token: string;
  short_order_id: string;
  product_metadata: Record<string, unknown>;
  created_at: string;
}

export async function generateExport(args: {
  purchaseId: string;
  config: Config;
}): Promise<void> {
  const { purchaseId, config } = args;
  // Cast to any: typed createClient<schema> would narrow query builders to `never`
  // for our dynamic update/insert calls. We don't have generated types here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    { auth: { persistSession: false } },
  );

  // Load the purchase row.
  const { data: purchaseData, error: loadErr } = await supabase
    .from('download_purchases')
    .select(
      'id, product_id, stripe_session_id, email, status, download_token, short_order_id, product_metadata, created_at',
    )
    .eq('id', purchaseId)
    .single();

  if (loadErr || !purchaseData) {
    throw new Error(
      `generate-export: purchase ${purchaseId} not found: ${loadErr?.message ?? 'no data'}`,
    );
  }

  const purchase = purchaseData as unknown as PurchaseRow;

  // Idempotency: skip if already ready or actively processing.
  if (purchase.status === 'ready' || purchase.status === 'processing') {
    console.log(
      `[generate-export] purchase ${purchaseId} already in status=${purchase.status}, skipping`,
    );
    return;
  }

  const ip = String(purchase.product_metadata.ip ?? '');
  if (!ip) {
    await markFailed(supabase, purchaseId, 'product_metadata.ip missing');
    throw new Error(`generate-export: purchase ${purchaseId} missing ip`);
  }

  // Mark processing.
  await supabase
    .from('download_purchases')
    .update({ status: 'processing' })
    .eq('id', purchaseId);

  try {
    // 1. Query ClickHouse for hostnames.
    const ch = createReverseIpClient(config.clickhouse);
    const rows = await ch.listHostnamesForIp(ip, ROW_LIMIT);

    // 2. Build fingerprinted artifacts.
    const issuedAt = new Date().toISOString();
    const contentKey = `ip:${ip}`;
    const fingerprintMeta: FingerprintMeta = {
      short_order_id: purchase.short_order_id,
      download_token: purchase.download_token,
      issued_at: issuedAt,
      product_id: purchase.product_id,
      content_key: contentKey,
    };

    const csv = writeCsvWithHeader({
      fingerprintMeta,
      columns: COLUMNS as unknown as string[],
      rows: rows as unknown as Record<string, unknown>[],
    });
    const jsonl = writeJsonlWithMeta({
      fingerprintMeta,
      rows: rows as unknown as Record<string, unknown>[],
    });
    const manifest = buildManifest({
      fingerprintMeta,
      count: rows.length,
      csv,
      jsonl,
      secret: config.download.fingerprintSecret,
    });

    // 3. Upload to S3.
    const s3 = new S3Client({
      region: config.download.s3Region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
    const keyPrefix = `purchases/${purchase.id}`;
    const csvKey = `${keyPrefix}/reverse-ip-${ip}.csv`;
    const jsonlKey = `${keyPrefix}/reverse-ip-${ip}.jsonl`;
    const manifestKey = `${keyPrefix}/manifest.json`;

    await s3.send(
      new PutObjectCommand({
        Bucket: config.download.s3Bucket,
        Key: csvKey,
        Body: csv,
        ContentType: 'text/csv',
      }),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: config.download.s3Bucket,
        Key: jsonlKey,
        Body: jsonl,
        ContentType: 'application/x-ndjson',
      }),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: config.download.s3Bucket,
        Key: manifestKey,
        Body: manifest.serialized,
        ContentType: 'application/json',
      }),
    );

    // 4. Generate 7-day presigned URLs.
    const csvUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.download.s3Bucket,
        Key: csvKey,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
    const jsonlUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.download.s3Bucket,
        Key: jsonlKey,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
    const manifestUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.download.s3Bucket,
        Key: manifestKey,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );

    const readyAt = new Date().toISOString();
    const urlExpiresAt = new Date(
      Date.now() + PRESIGN_TTL_SECONDS * 1000,
    ).toISOString();

    // 5. Update purchase row to ready.
    const { error: updateErr } = await supabase
      .from('download_purchases')
      .update({
        status: 'ready',
        s3_csv_key: csvKey,
        s3_jsonl_key: jsonlKey,
        s3_manifest_key: manifestKey,
        download_csv_url: csvUrl,
        download_jsonl_url: jsonlUrl,
        download_manifest_url: manifestUrl,
        url_expires_at: urlExpiresAt,
        ready_at: readyAt,
      })
      .eq('id', purchaseId);

    if (updateErr) {
      throw new Error(
        `generate-export: failed to update purchase ${purchaseId}: ${updateErr.message}`,
      );
    }

    // 6. Audit event.
    await supabase.from('download_events').insert({
      purchase_id: purchaseId,
      event_type: 'status_changed',
      metadata: {
        from: 'processing',
        to: 'ready',
        row_count: rows.length,
      },
    });

    // 7. Send SES email.
    await sendReadyEmail({
      from: config.download.sesFrom,
      to: purchase.email,
      shortOrderId: purchase.short_order_id,
      ip,
      rowCount: rows.length,
      csvUrl,
      jsonlUrl,
      manifestUrl,
      region: config.download.s3Region,
    });

    // 8. Fire-and-forget Telegram.
    void notifyTelegram(config, '✅', 'Bulk export ready', {
      order_id: purchase.short_order_id,
      ip,
      rows: String(rows.length),
      email: purchase.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(supabase, purchaseId, message);
    void notifyTelegram(config, '❌', 'Bulk export failed', {
      purchase_id: purchaseId,
      error: message,
    });
    throw err;
  }
}

// `any` for the supabase param: createClient<unknown,...> narrows the
// schema-typed query builders to `never`, which fails on dynamic
// `.update({...})` and `.insert({...})` calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markFailed(
  supabase: any,
  purchaseId: string,
  errorMessage: string,
): Promise<void> {
  // download_purchases has no `error_message` column in the current schema
  // (Plan A migration 20260427090000). The error is recorded in the
  // append-only download_events audit log instead. If a top-level
  // error_message column is added later, write to it here too.
  await supabase
    .from('download_purchases')
    .update({ status: 'failed' })
    .eq('id', purchaseId);
  await supabase.from('download_events').insert({
    purchase_id: purchaseId,
    event_type: 'status_changed',
    metadata: { from: 'processing', to: 'failed', error: errorMessage },
  });
}

async function sendReadyEmail(args: {
  from: string;
  to: string;
  shortOrderId: string;
  ip: string;
  rowCount: number;
  csvUrl: string;
  jsonlUrl: string;
  manifestUrl: string;
  region: string;
}): Promise<void> {
  const ses = new SESv2Client({ region: args.region });
  const subject = `Your DNS Checker bulk export is ready (Order ${args.shortOrderId})`;
  const text = [
    `Your reverse-IP bulk export is ready.`,
    ``,
    `Order: ${args.shortOrderId}`,
    `IP: ${args.ip}`,
    `Hostnames: ${args.rowCount}`,
    ``,
    `CSV: ${args.csvUrl}`,
    `JSONL: ${args.jsonlUrl}`,
    `Manifest: ${args.manifestUrl}`,
    ``,
    `Links expire in 7 days. Sign in at https://dnschkr.com/dashboard/downloads to regenerate them.`,
  ].join('\n');
  const html = `<p>Your reverse-IP bulk export is ready.</p>
<ul>
  <li><strong>Order:</strong> ${args.shortOrderId}</li>
  <li><strong>IP:</strong> ${args.ip}</li>
  <li><strong>Hostnames:</strong> ${args.rowCount}</li>
</ul>
<p>
  <a href="${args.csvUrl}">Download CSV</a> ·
  <a href="${args.jsonlUrl}">Download JSONL</a> ·
  <a href="${args.manifestUrl}">Manifest</a>
</p>
<p>Links expire in 7 days. Sign in at <a href="https://dnschkr.com/dashboard/downloads">dnschkr.com/dashboard/downloads</a> to regenerate them.</p>`;
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: args.from,
      Destination: { ToAddresses: [args.to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: text, Charset: 'UTF-8' },
          },
        },
      },
    }),
  );
}

async function notifyTelegram(
  config: Config,
  emoji: string,
  title: string,
  fields: Record<string, string>,
): Promise<void> {
  if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
    return;
  }
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  const text = `${emoji} ${title}\n${lines}`;
  try {
    await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text,
        }),
      },
    );
  } catch (err) {
    console.error('[telegram] notify failed', err);
  }
}
