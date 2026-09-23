export interface IpIntel {
  asn: string;
  country: string;
  city: string;
  org: string;
  is_cdn: boolean;
  threats: string[];
}

/**
 * ASNs whose address space fronts many unrelated sites.
 *
 * dnschkr-ip has no `is_cdn` field. It never has. The previous code read
 * `classification.is_cdn`, which does not exist in the response, so the flag
 * was always false and the CDN warning banner could not fire for any IP —
 * including the Cloudflare addresses it was written for. Deciding this from
 * the ASN is a stated heuristic rather than a field that silently reads
 * `undefined`.
 */
const CDN_ASNS = new Set([
  13335, // Cloudflare
  54113, // Fastly
  20940, // Akamai
  16625, // Akamai
  21342, // Akamai
  16509, // Amazon (CloudFront shares this)
  14618, // Amazon
  15169, // Google
  8075, // Microsoft
  22822, // Edgio
  60068, // Datacamp / CDN77
  19551, // Imperva
  32934, // Meta
]);

/**
 * The shape below is the response dnschkr-ip actually returns, verified
 * against the live service. Every field the previous version read
 * (`asn`, `asn_org`, `country`, `city`, `threats`) was top-level and none of
 * them exist there, so this object came back entirely blank on every lookup
 * and the IP context card rendered empty for every IP.
 */
interface IpServiceResponse {
  geo?: { country?: string; city?: string };
  network?: { asn?: number; organization?: string; isp?: string };
  security?: { detection_sources?: string[]; threat_level?: string };
  service?: { name?: string; category?: string };
}

export async function fetchIpIntel(args: {
  ip: string;
  serviceUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<IpIntel | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 5000);
  try {
    const resp = await fetch(`${args.serviceUrl}/lookup/${encodeURIComponent(args.ip)}`, {
      headers: { Authorization: `Bearer ${args.apiKey}` },
      signal: controller.signal,
    });
    if (!resp.ok) return null;

    const data = (await resp.json()) as IpServiceResponse;
    const asn = data.network?.asn;
    const org = data.network?.organization ?? data.network?.isp ?? '';

    return {
      asn: asn ? `AS${asn}` : '',
      country: data.geo?.country ?? '',
      city: data.geo?.city ?? '',
      org,
      is_cdn: typeof asn === 'number' && CDN_ASNS.has(asn),
      threats: data.security?.detection_sources ?? [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
