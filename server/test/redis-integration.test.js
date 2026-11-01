// Runs the real Lua scripts and real SETEX/GET against a real Redis server.
// Skipped unless DEVFLOW_TEST_REDIS_URL is set, e.g.
//   DEVFLOW_TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
// (docker compose up -d redis provides one). No database is needed.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { after, before } from 'node:test';

const url = process.env.DEVFLOW_TEST_REDIS_URL;
const skip = url ? false : 'set DEVFLOW_TEST_REDIS_URL to run against a real Redis';

process.env.NODE_ENV = 'test';
const prefix = `devflow-test-${randomBytes(4).toString('hex')}`;
process.env.DEVFLOW_REDIS_PREFIX = prefix;

let client;
let redisLib;
let cache;
let createRateLimiter;

before(async () => {
  if (skip) return;
  const { createClient } = await import('redis');
  client = createClient({ url, disableOfflineQueue: true });
  await client.connect();
  [redisLib, cache, { createRateLimiter }] = await Promise.all([
    import('../src/lib/redis.js'),
    import('../src/services/cache.service.js'),
    import('../src/middleware/rateLimit.js'),
  ]);
  redisLib.setRedisClientForTests(client);
});

after(async () => {
  if (!client) return;
  const keys = await client.keys(`${prefix}:*`);
  if (keys.length) await client.del(keys);
  redisLib.setRedisClientForTests(null);
  await client.quit();
});

function callLimiter(limiter, id) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const res = {
      statusCode: 200,
      set(name, value) { headers.set(name.toLowerCase(), String(value)); return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, headers, body }); return this; },
    };
    limiter({ get: () => id }, res, (error) => (error ? reject(error) : resolve({ status: 200, headers })));
  });
}

test('rate limiter Lua script: exact limit under concurrency, shared by two limiter objects, with a real TTL', { skip }, async () => {
  const options = { name: 'it-login', windowMs: 5000, limit: 5, key: (req) => req.get() };
  const a = createRateLimiter(options);
  const b = createRateLimiter(options);
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => callLimiter(i % 2 ? a : b, 'same-client')));
  assert.equal(results.filter((r) => r.status === 200).length, 5);
  assert.equal(results.filter((r) => r.status === 429).length, 35);
  assert.ok(results.every((r) => !r.headers.has('x-ratelimit-mode')), 'real Redis was used, not the fallback');

  const [key] = await client.keys(`${prefix}:ratelimit:it-login:*`);
  const ttl = await client.pTTL(key);
  assert.ok(ttl > 0 && ttl <= 5000, `window key must expire, pttl=${ttl}`);
});

test('rate limiter window actually resets in real Redis', { skip }, async () => {
  const limiter = createRateLimiter({ name: 'it-reset', windowMs: 300, limit: 1, key: (req) => req.get() });
  assert.equal((await callLimiter(limiter, 'x')).status, 200);
  assert.equal((await callLimiter(limiter, 'x')).status, 429);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal((await callLimiter(limiter, 'x')).status, 200);
});

test('dashboard cache round-trip, TTL and invalidation in real Redis', { skip }, async () => {
  const miss = await cache.readDashboardCache('501', '9');
  assert.equal(miss.status, 'miss');
  assert.equal(await cache.writeDashboardCache('501', '9', miss.version, { hello: 'world' }), true);
  const hit = await cache.readDashboardCache('501', '9');
  assert.equal(hit.status, 'hit');
  assert.deepEqual(hit.payload, { hello: 'world' });

  const [dataKey] = await client.keys(`${prefix}:dashboard:ws:501:u:9:*`);
  const ttl = await client.ttl(dataKey);
  assert.ok(ttl > 0 && ttl <= 60, `ttl=${ttl}`);

  assert.equal(await cache.invalidateWorkspaceDashboard('501'), true);
  assert.equal((await cache.readDashboardCache('501', '9')).status, 'miss');
  assert.equal((await cache.readDashboardCache('502', '9')).status, 'miss', 'other workspace unaffected and isolated');
});
