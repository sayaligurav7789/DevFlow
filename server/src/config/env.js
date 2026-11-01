import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load server/.env regardless of the directory the process was started from.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function parsePort(value, fallback) {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseInteger(value, fallback, { min, max }) {
  const number = Number.parseInt(value ?? '', 10);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';

function redisUrl() {
  if (process.env.DEVFLOW_REDIS_URL) return process.env.DEVFLOW_REDIS_URL;
  const host = process.env.DEVFLOW_REDIS_HOST || '127.0.0.1';
  const port = parsePort(process.env.DEVFLOW_REDIS_PORT, 6379);
  const password = process.env.DEVFLOW_REDIS_PASSWORD;
  const auth = password ? `:${encodeURIComponent(password)}@` : '';
  return `redis://${auth}${host}:${port}`;
}

export const config = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: parsePort(process.env.PORT, 5000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  apiOrigin: process.env.API_ORIGIN || `http://localhost:${parsePort(process.env.PORT, 5000)}`,
  integrations: Object.freeze({
    encryptionKey: process.env.INTEGRATIONS_ENCRYPTION_KEY || '',
    github: Object.freeze({
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    }),
    slack: Object.freeze({
      clientId: process.env.SLACK_CLIENT_ID || '',
      clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    }),
  }),
  sessionSecret: process.env.SESSION_SECRET || '',
  ai: Object.freeze({
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  }),
  database: Object.freeze({
    host: process.env.DEVFLOW_DB_HOST || '127.0.0.1',
    port: parsePort(process.env.DEVFLOW_DB_PORT, 5432),
    name: process.env.DEVFLOW_DB_NAME || 'devflow',
    user: process.env.DEVFLOW_DB_USER || 'devflow',
    password: process.env.DEVFLOW_DB_PASSWORD || '',
  }),
  // Set to the number of reverse proxies in front of the API (e.g. 1 behind one load balancer) so
  // req.ip, and therefore the rate limiter, sees the real client address. 0 = trust none.
  trustProxy: parseInteger(process.env.DEVFLOW_TRUST_PROXY, 0, { min: 0, max: 10 }),
  redis: Object.freeze({
    // Tests never open a socket unless a test opts in (they inject a fake client instead).
    enabled: parseBoolean(process.env.DEVFLOW_REDIS_ENABLED, nodeEnv !== 'test'),
    url: redisUrl(),
    keyPrefix: process.env.DEVFLOW_REDIS_PREFIX || 'devflow',
    commandTimeoutMs: parseInteger(process.env.DEVFLOW_REDIS_COMMAND_TIMEOUT_MS, 300, { min: 20, max: 5000 }),
    // After a Redis error, skip Redis entirely for this long so every request is not slowed down.
    breakerCooldownMs: parseInteger(process.env.DEVFLOW_REDIS_BREAKER_COOLDOWN_MS, 5000, { min: 100, max: 60_000 }),
  }),
  cache: Object.freeze({
    dashboardTtlSeconds: parseInteger(process.env.DEVFLOW_DASHBOARD_CACHE_TTL_SECONDS, 60, { min: 1, max: 3600 }),
  }),
  notifications: Object.freeze({
    integrationOutboxIntervalMs: parseInteger(process.env.DEVFLOW_INTEGRATION_OUTBOX_INTERVAL_MS, 5000, { min: 1000, max: 60000 }),
    deadlineSweepEnabled: parseBoolean(process.env.DEVFLOW_DEADLINE_SWEEP_ENABLED, nodeEnv !== 'test'),
    deadlineSweepIntervalMs: parseInteger(
      process.env.DEVFLOW_DEADLINE_SWEEP_INTERVAL_MS, 15 * 60 * 1000, { min: 1000, max: 24 * 60 * 60 * 1000 },
    ),
    dueSoonWindowHours: parseInteger(process.env.DEVFLOW_DUE_SOON_WINDOW_HOURS, 24, { min: 1, max: 168 }),
  }),
});
