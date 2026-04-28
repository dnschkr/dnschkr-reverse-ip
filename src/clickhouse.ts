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

const COUNT_SQL = `
  SELECT count(*) AS total
  FROM ip_to_hostname
  WHERE ip = {ip:IPv4}
    AND last_seen >= now() - INTERVAL 7 DAY
`;

const LIST_SQL = `
  SELECT
    itoh.hostname AS hostname,
    itoh.record_type AS record_type,
    formatDateTime(itoh.first_seen, '%Y-%m-%dT%H:%i:%SZ') AS first_seen,
    formatDateTime(itoh.last_seen, '%Y-%m-%dT%H:%i:%SZ') AS last_seen,
    h.is_apex AS is_apex,
    h.tld AS tld
  FROM ip_to_hostname itoh
  LEFT JOIN hostnames h ON h.hostname = itoh.hostname
  WHERE itoh.ip = {ip:IPv4}
    AND itoh.last_seen >= now() - INTERVAL 7 DAY
  ORDER BY itoh.last_seen DESC
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
          first_seen: string;
          last_seen: string;
          is_apex: number | string;
          tld: string;
        }>;
      };
      return data.data.map((row) => ({
        hostname: row.hostname,
        record_type: row.record_type as 'A' | 'AAAA',
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        is_apex: row.is_apex === 1 || row.is_apex === '1',
        tld: row.tld,
      }));
    },
  };
}
