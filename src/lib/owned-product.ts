import { createClient } from '@supabase/supabase-js';

let cached: ReturnType<typeof createClient> | null = null;
function getClient(url: string, serviceRoleKey: string) {
  if (!cached) {
    cached = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return cached;
}

export interface OwnedPurchaseSummary {
  purchase_id: string;
  purchased_at: string;
  access_expires_at: string;
  url_expires_at: string | null;
  download_csv_url: string | null;
  download_jsonl_url: string | null;
  download_manifest_url: string | null;
  needs_url_regeneration: boolean;
}

export async function findOwnedPurchase(args: {
  userId: string | null;
  ip: string;
  productId: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}): Promise<OwnedPurchaseSummary | null> {
  if (!args.userId) return null;

  const supabase = getClient(args.supabaseUrl, args.supabaseServiceRoleKey);
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('download_purchases')
    .select(
      'id, created_at, access_expires_at, url_expires_at, download_csv_url, download_jsonl_url, download_manifest_url',
    )
    .eq('user_id', args.userId)
    .eq('product_id', args.productId)
    .eq('status', 'ready')
    .gt('access_expires_at', nowIso)
    .filter('product_metadata->>ip', 'eq', args.ip)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[owned-product] supabase error', error);
    return null;
  }
  if (!data) return null;

  const oneDayMs = 24 * 60 * 60 * 1000;
  const needsRegen =
    !data.url_expires_at ||
    new Date(data.url_expires_at).getTime() - Date.now() < oneDayMs;

  return {
    purchase_id: data.id,
    purchased_at: data.created_at,
    access_expires_at: data.access_expires_at,
    url_expires_at: data.url_expires_at,
    download_csv_url: data.download_csv_url,
    download_jsonl_url: data.download_jsonl_url,
    download_manifest_url: data.download_manifest_url,
    needs_url_regeneration: needsRegen,
  };
}
