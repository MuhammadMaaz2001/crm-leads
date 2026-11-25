/**
 * Central runtime configuration. Fail closed in production.
 */

import './loadEnv.js';

function read(name: string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : undefined;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const nodeEnv = read('NODE_ENV') ?? 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test' || read('ALLOW_ACTIVITY_SEED') === '1';
const enableApiDocs = !isProd || read('ENABLE_API_DOCS') === 'true';

function requireJwtSecret(): string {
  const secret = read('JWT_SECRET');
  if (secret) return secret;
  if (isProd) {
    throw new Error('JWT_SECRET is required in production');
  }
  if (isTest) {
    return 'testing-jwt-secret-not-for-prod';
  }
  throw new Error(
    'JWT_SECRET is required. Copy .env.example → .env.local (or testing/functional/.env.testing) and set a long random value.'
  );
}

const corsOrigins = parseList(read('CORS_ORIGINS'));

export const config = {
  nodeEnv,
  isProd,
  isTest,
  enableApiDocs,
  port: Number(read('PORT') ?? 4000),
  jwtSecret: requireJwtSecret(),
  corsOrigins,
  aws: {
    accessKeyId: read('AWS_ACCESS_KEY_ID'),
    secretAccessKey: read('AWS_SECRET_ACCESS_KEY'),
    region: read('AWS_REGION'),
    bucket: read('AWS_S3_BUCKET'),
  },
} as const;

const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Standard email format check (any domain). */
export function isValidEmail(email: string): boolean {
  const normalized = email.trim();
  return normalized.length <= 254 && EMAIL_FORMAT.test(normalized);
}

export const INVALID_EMAIL_ERROR = 'A valid email is required.';

export function resolveCorsOrigin(origin: string | undefined): boolean | string {
  if (!config.corsOrigins.length) {
    // Reflect request origin in development; deny cross-origin in production
    // unless CORS_ORIGINS is set (same-origin SPA + reverse proxy is fine).
    if (!isProd) return origin ?? true;
    return false;
  }
  if (!origin) return false;
  return config.corsOrigins.includes(origin) ? origin : false;
}
