export interface IpIntel {
  asn: string;
  country: string;
  city: string;
  org: string;
  is_cdn: boolean;
  threats: string[];
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
    const data = (await resp.json()) as {
      asn?: string;
      asn_org?: string;
      country?: string;
      city?: string;
      is_cdn?: boolean;
      threats?: string[];
    };
    return {
      asn: [data.asn, data.asn_org].filter(Boolean).join(' '),
      country: data.country ?? '',
      city: data.city ?? '',
      org: data.asn_org ?? '',
      is_cdn: Boolean(data.is_cdn),
      threats: data.threats ?? [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
