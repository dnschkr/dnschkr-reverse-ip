import { createClient, type ClickHouseClient } from '@clickhouse/client';

export interface ReverseIpClientConfig {
  url: string;
  user: string;
  password: string;
}

export interface HostnameRow {
  hostname: string;
  record_type: 'A' | 'AAAA';
  last_seen: string;
  is_apex: boolean;
  tld: string;
}

export interface TldFacet {
  tld: string;
  count: number;
}

export interface ReverseIpSummary {
  /** Distinct (hostname, record_type) pairs inside the freshness window. */
  total: number;
  /** Most recent observation of this IP, ISO-8601, or null if never seen. */
  latest_scan: string | null;
  /** Hostname counts per TLD, largest first. */
  tlds: TldFacet[];
}

export interface ReverseIpClient {
  summarizeIp(ip: string): Promise<ReverseIpSummary>;
  listHostnamesForIp(ip: string, limit: number, tld?: string | null): Promise<HostnameRow[]>;
}

// echo-1's ip_to_hostname.ip column is String (not IPv4); bind the param as
// String to avoid a "no supertype for types String, IPv4" comparison error.
//
// ip_to_hostname is ReplacingMergeTree(last_seen) ordered by (ip, hostname,
// record_type). Async merges leave duplicate (ip, hostname, record_type)
// rows in pre-merge state, so both queries collapse with GROUP BY / uniqExact
// instead of FINAL (FINAL on a 2.5B-row table is far too slow at request time).
//
// FRESHNESS WINDOW — this is measured against the LATEST OBSERVATION OF THIS
// IP, not against now(). The previous `last_seen >= now() - INTERVAL 7 DAY`
// silently coupled every result to the health of a nightly job: the
// `refresh-ip-hostname` job failed from 2026-09-15 to 2026-09-20, which pushed
// the newest row in the table to 2026-09-06 and put the whole dataset outside
// a now()-relative 7-day window. For that week this tool returned ZERO
// hostnames for EVERY IP and reported it as a successful lookup with no
// results. Anchoring to the data's own high-water mark means a stale pipeline
// degrades to stale answers (with the date shown) instead of confidently
// claiming an IP hosts nothing.
const LATEST_FOR_IP = `(SELECT max(last_seen) FROM ip_to_hostname WHERE ip = {ip:String})`;

// One round trip for the count, the freshness date and the TLD breakdown.
// The TLD facets are what make a capped result set honest: an IP with 8,630
// hostnames can only ever show the first N, so the page needs to state what
// the other rows are rather than implying the visible sample is the shape of
// the data.
const SUMMARY_SQL = `
  WITH ${LATEST_FOR_IP} AS latest
  SELECT
    splitByChar('.', cutToFirstSignificantSubdomain(hostname))[-1] AS tld,
    uniqExact((hostname, record_type)) AS n,
    formatDateTime(max(latest), '%Y-%m-%dT%H:%i:%SZ') AS latest_iso
  FROM ip_to_hostname
  WHERE ip = {ip:String}
    AND latest IS NOT NULL
    AND last_seen >= latest - INTERVAL 7 DAY
  GROUP BY tld
  ORDER BY n DESC, tld ASC
`;

// Both columns are derived from the hostname string with ClickHouse's built-in
// PSL functions rather than a JOIN against the 258M-row `hostnames` table.
// That JOIN measured ~4.5s per request on every algorithm; this is ~0.4s and
// stays flat across IP volumes. `cutToFirstSignificantSubdomain` understands
// compound suffixes (example.co.uk), so it is also more accurate.
//
// ORDER BY is `hostname`, NOT `max(last_seen) DESC`. The refresh job rewrites
// every row for an IP in a single batch, so all rows carry an identical
// timestamp and a sort on it is a total tie broken by physical storage order.
// That is why the first 50 results for 8.8.8.8 were almost entirely `.top`
// spam when `.top` is 2.8% of the data and `.com` is 41%: the page-one sample
// was arbitrary and wildly unrepresentative, and it changed between identical
// requests. Alphabetical is deterministic and reproducible, and invents no
// ranking the data does not support. Use the TLD facet to slice.
//
// IMPORTANT: SELECT aliases use *_iso names rather than reusing the column
// names. ClickHouse's optimizer pushes SELECT alias expressions into
// WHERE/ORDER BY, so aliasing `formatDateTime(last_seen, ...) AS last_seen`
// makes the WHERE clause compare a String against a DateTime (NO_COMMON_TYPE).
const LIST_SQL = `
  WITH ${LATEST_FOR_IP} AS latest
  SELECT
    hostname,
    record_type,
    formatDateTime(max(last_seen), '%Y-%m-%dT%H:%i:%SZ') AS last_seen_iso,
    hostname = cutToFirstSignificantSubdomain(hostname) AS is_apex,
    splitByChar('.', cutToFirstSignificantSubdomain(hostname))[-1] AS tld
  FROM ip_to_hostname
  WHERE ip = {ip:String}
    AND latest IS NOT NULL
    AND last_seen >= latest - INTERVAL 7 DAY
    AND ({tld:String} = '' OR splitByChar('.', cutToFirstSignificantSubdomain(hostname))[-1] = {tld:String})
  GROUP BY hostname, record_type
  ORDER BY hostname
  LIMIT {limit:UInt32}
`;

export function createReverseIpClient(
  config: ReverseIpClientConfig,
): ReverseIpClient {
  const client: ClickHouseClient = createClient({
    url: config.url,
    username: config.user,
    password: config.password,
    database: 'dns_intelligence',
    request_timeout: 30_000,
  });

  return {
    async summarizeIp(ip) {
      const result = await client.query({
        query: SUMMARY_SQL,
        query_params: { ip },
        format: 'JSON',
      });
      const { data } = (await result.json()) as {
        data: { tld: string; n: string; latest_iso: string }[];
      };

      const tlds = data.map((r) => ({ tld: r.tld, count: parseInt(r.n, 10) }));
      return {
        total: tlds.reduce((sum, t) => sum + t.count, 0),
        latest_scan: data[0]?.latest_iso ?? null,
        tlds,
      };
    },

    async listHostnamesForIp(ip, limit, tld) {
      const result = await client.query({
        query: LIST_SQL,
        query_params: { ip, limit, tld: tld ?? '' },
        format: 'JSON',
      });
      const { data } = (await result.json()) as {
        data: {
          hostname: string;
          record_type: 'A' | 'AAAA';
          last_seen_iso: string;
          is_apex: 0 | 1;
          tld: string;
        }[];
      };
      return data.map((r) => ({
        hostname: r.hostname,
        record_type: r.record_type,
        last_seen: r.last_seen_iso,
        is_apex: Boolean(r.is_apex),
        tld: r.tld,
      }));
    },
  };
}
