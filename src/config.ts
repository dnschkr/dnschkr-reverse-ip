// src/config.ts
import { z } from 'zod';

const envSchema = z.object({
  PORT: z
    .string()
    .default('3300')
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(65535)),
  API_KEY: z.string().min(32, 'API_KEY must be at least 32 chars'),
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),
  IP_SERVICE_URL: z.string().url(),
  IP_SERVICE_API_KEY: z.string().min(8),
  DOWNLOAD_FINGERPRINT_SECRET: z
    .string()
    .min(32, 'DOWNLOAD_FINGERPRINT_SECRET must be at least 32 bytes'),
  S3_DOWNLOADS_BUCKET: z.string().min(1),
  S3_DOWNLOADS_REGION: z.string().default('us-east-1'),
  AWS_SES_FROM_DOWNLOADS: z.string().email(),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_NOTIFICATION: z
    .enum(['TRUE', 'FALSE'])
    .optional()
    .default('FALSE'),
});

export type Config = {
  port: number;
  apiKey: string;
  clickhouse: { url: string; user: string; password: string };
  ipService: { url: string; apiKey: string };
  download: {
    fingerprintSecret: string;
    s3Bucket: string;
    s3Region: string;
    sesFrom: string;
  };
  aws: { accessKeyId: string; secretAccessKey: string };
  supabase: { url: string; serviceRoleKey: string };
  telegram: { enabled: boolean; botToken?: string; chatId?: string };
};

export function loadConfig(): Config {
  const parsed = envSchema.parse(process.env);
  return {
    port: parsed.PORT,
    apiKey: parsed.API_KEY,
    clickhouse: {
      url: parsed.CLICKHOUSE_URL,
      user: parsed.CLICKHOUSE_USER,
      password: parsed.CLICKHOUSE_PASSWORD,
    },
    ipService: { url: parsed.IP_SERVICE_URL, apiKey: parsed.IP_SERVICE_API_KEY },
    download: {
      fingerprintSecret: parsed.DOWNLOAD_FINGERPRINT_SECRET,
      s3Bucket: parsed.S3_DOWNLOADS_BUCKET,
      s3Region: parsed.S3_DOWNLOADS_REGION,
      sesFrom: parsed.AWS_SES_FROM_DOWNLOADS,
    },
    aws: {
      accessKeyId: parsed.AWS_ACCESS_KEY_ID,
      secretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
    },
    supabase: {
      url: parsed.SUPABASE_URL,
      serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    },
    telegram: {
      enabled: parsed.TELEGRAM_NOTIFICATION === 'TRUE',
      botToken: parsed.TELEGRAM_BOT_TOKEN,
      chatId: parsed.TELEGRAM_CHAT_ID,
    },
  };
}
