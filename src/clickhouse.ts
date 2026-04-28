import { createClient, type ClickHouseClient } from '@clickhouse/client';

export interface ReverseIpClientConfig {
  url: string;
  user: string;
  password: string;
}

export interface HostnameRow {
  hostname: string;
  record_type: 'A' | 'AAAA';
  first_seen: string;
  last_seen: string;
  is_apex: boolean;
  tld: string;
}

export interface ReverseIpClient {
  countHostnamesForIp(ip: string): Promise<number>;
  listHostnamesForIp(ip: string, limit: number): Promise<HostnameRow[]>;
}

// echo-1's ip_to_hostname.ip column is String (not IPv4); bind the param as
// String to avoid a "no supertype for types String, IPv4" comparison error.
const COUNT_SQL = `
  SELECT count(*) AS total
  FROM ip_to_hostname
  WHERE ip = {ip:String}
    AND last_seen >= now() - INTERVAL 7 DAY
`;

// Earlier this query did `LEFT JOIN hostnames h ON h.hostname = itoh.hostname`
// to attach `is_apex` and `tld`. That JOIN took ~4.5s per request because
// ClickHouse's hash join builds the entire 258M-row right side regardless of
// algorithm (`hash`, `parallel_hash`, `partial_merge`, `auto` all measured
// ≥4.5s; `full_sorting_merge` blew up to 60s).
//
// Both columns can be derived from the hostname string directly using
// ClickHouse's built-in PSL functions, with no JOIN. `cutToFirstSignificantSubdomain`
// understands compound suffixes (e.g. `example.co.uk` → apex), so this is
// actually MORE accurate than the previous JOIN against `hostnames.is_apex`.
// Total query time drops from ~4.5s → ~340ms (~13× faster) and stays flat
// across IP volumes (verified for 1, 168, 6,001, and 11,508-row IPs).
//
// IMPORTANT: SELECT aliases use *_iso names rather than reusing the column
// names (`first_seen`, `last_seen`). ClickHouse's optimizer pushes SELECT
// alias expressions into WHERE/ORDER BY, so aliasing
// `formatDateTime(last_seen, ...) AS last_seen` causes the WHERE clause to
// compare a String against `now() - INTERVAL 7 DAY` (DateTime), which raises
// NO_COMMON_TYPE.
const LIST_SQL = `
  SELECT
    hostname,
    record_type,
    formatDateTime(first_seen, '%Y-%m-%dT%H:%i:%SZ') AS first_seen_iso,
    formatDateTime(last_seen, '%Y-%m-%dT%H:%i:%SZ') AS last_seen_iso,
    hostname = cutToFirstSignificantSubdomain(hostname) AS is_apex,
    splitByChar('.', cutToFirstSignificantSubdomain(hostname))[-1] AS tld
  FROM ip_to_hostname
  WHERE ip = {ip:String}
    AND last_seen >= now() - INTERVAL 7 DAY
  ORDER BY last_seen DESC
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
    async countHostnamesForIp(ip) {
      const result = await client.query({
        query: COUNT_SQL,
        query_params: { ip },
        format: 'JSON',
      });
      const data = (await result.json()) as { data: { total: string }[] };
      return parseInt(data.data[0]?.total ?? '0', 10);
    },

    async listHostnamesForIp(ip, limit) {
      const result = await client.query({
        query: LIST_SQL,
        query_params: { ip, limit },
        format: 'JSON',
      });
      const data = (await result.json()) as {
        data: Array<{
          hostname: string;
          record_type: string;
          first_seen_iso: string;
          last_seen_iso: string;
          is_apex: number | string;
          tld: string;
        }>;
      };
      return data.data.map((row) => ({
        hostname: row.hostname,
        record_type: row.record_type as 'A' | 'AAAA',
        first_seen: row.first_seen_iso,
        last_seen: row.last_seen_iso,
        is_apex: row.is_apex === 1 || row.is_apex === '1',
        tld: row.tld,
      }));
    },
  };
}
