// Single place that owns the Redis connection.
//
// Redis is an optimisation layer, never the source of truth: PostgreSQL stays authoritative. Every
// caller therefore goes through redisCall(), which fails fast (never hangs a request) and lets the
// caller fall back to PostgreSQL. Three mechanisms keep a Redis outage from hurting the API:
//   1. disableOfflineQueue - commands issued while disconnected reject immediately instead of
//      queueing until the connection returns.
//   2. A per-command timeout - a connected-but-stalled Redis cannot hold a request open.
//   3. A circuit breaker - after one failure Redis is skipped for a short cooldown, so a dead
//      server costs one slow request, not one per request.
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class RedisUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'RedisUnavailableError';
  }
}

let client = null; // real client (or a test double)
let injected = false; // true when a test supplied the client
let starting = null;
let breakerOpenUntil = 0;
let lastConnectionLog = 0;

function logConnectionProblem(error) {
  // The client emits 'error' on every failed reconnect attempt; log at most once per 30 seconds.
  const now = Date.now();
  if (now - lastConnectionLog < 30_000) return;
  lastConnectionLog = now;
  logger.warn(`Redis connection problem (falling back to PostgreSQL): ${error?.message ?? error}`);
}

async function connect() {
  // Loaded lazily so a missing optional install degrades to "no Redis" instead of a crash at boot.
  const { createClient } = await import('redis');
  const next = createClient({
    url: config.redis.url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 5000),
    },
  });
  next.on('error', logConnectionProblem);
  next.on('ready', () => logger.info('Redis connection ready'));
  next.on('end', () => logger.warn('Redis connection closed'));
  client = next;
  // With a numeric reconnectStrategy the returned promise only settles once connected, so it is
  // deliberately not awaited: the API must be able to serve traffic while Redis is still down.
  next.connect().catch(logConnectionProblem);
}

// Begin connecting in the background (idempotent). Safe to call when Redis is disabled.
export function startRedis() {
  if (injected || !config.redis.enabled || client || starting) return;
  starting = connect()
    .catch((error) => {
      logger.error(`Could not start the Redis client (running without Redis): ${error.message}`);
    })
    .finally(() => {
      starting = null;
    });
}

function readyClient() {
  if (injected) return client;
  if (!config.redis.enabled) return null;
  if (!client && !starting) startRedis();
  return client?.isReady ? client : null;
}

export function isRedisAvailable() {
  return Boolean(readyClient()) && Date.now() >= breakerOpenUntil;
}

function tripBreaker(label, error) {
  breakerOpenUntil = Date.now() + config.redis.breakerCooldownMs;
  logger.warn(`Redis ${label} failed; using PostgreSQL fallback for ${config.redis.breakerCooldownMs}ms: ${error.message}`);
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new RedisUnavailableError(`Redis ${label} timed out after ${config.redis.commandTimeoutMs}ms`)),
      config.redis.commandTimeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Run `operation(redis)` with fail-fast semantics. Throws RedisUnavailableError (or the client's
// own error) when Redis cannot answer; callers decide what the PostgreSQL fallback is.
export async function redisCall(label, operation) {
  const redis = readyClient();
  if (!redis) throw new RedisUnavailableError('Redis is not connected');
  if (Date.now() < breakerOpenUntil) throw new RedisUnavailableError('Redis circuit breaker is open');
  try {
    return await withTimeout(Promise.resolve().then(() => operation(redis)), label);
  } catch (error) {
    tripBreaker(label, error);
    throw error;
  }
}

export function redisKey(...parts) {
  return [config.redis.keyPrefix, ...parts].join(':');
}

export async function closeRedis() {
  const current = client;
  client = null;
  starting = null;
  breakerOpenUntil = 0;
  if (!current || injected) return;
  try {
    await current.quit();
  } catch {
    current.disconnect?.();
  }
}

// Test seam: install a fake (or real, test-owned) client, or pass null to restore normal behaviour.
export function setRedisClientForTests(fake) {
  injected = fake !== null && fake !== undefined;
  client = injected ? fake : null;
  starting = null;
  breakerOpenUntil = 0;
}

export function resetRedisBreakerForTests() {
  breakerOpenUntil = 0;
}
