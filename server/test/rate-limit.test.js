// Distributed rate limiting, tested against an in-memory Redis double (see test-support/fakeRedis.js).
// No database and no HTTP server are needed: the limiter is driven through its Express middleware
// contract, (req, res, next). Each "instance" below has its own limiter object (its own memory
// fallback), exactly like separate backend processes; the only thing they share is Redis.
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DEVFLOW_REDIS_COMMAND_TIMEOUT_MS = '60';
process.env.DEVFLOW_REDIS_BREAKER_COOLDOWN_MS = '100';

const [{ createRateLimiter, byUser }, redisLib, { FakeRedis }] = await Promise.all([
  import('../src/middleware/rateLimit.js'),
  import('../src/lib/redis.js'),
  import('../test-support/fakeRedis.js'),
]);

let fake;

// One backend "instance": its own limiter. post() runs the middleware against a mock request and
// resolves with what the client would see: status (200 when next() ran), headers and body.
function startInstance({ limit = 3, windowMs = 1000, name = 'login' } = {}) {
  const limiter = createRateLimiter({
    name, windowMs, limit,
    message: 'Too many login attempts. Try again later.',
    key: (req) => req.get('x-test-id') ?? 'anonymous',
  });
  const post = (id = 'client-1') => new Promise((resolve, reject) => {
    const headers = new Map();
    const res = {
      statusCode: 200,
      set(name, value) { headers.set(name.toLowerCase(), String(value)); return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, headers, body }); return this; },
    };
    const req = { get: (header) => (header.toLowerCase() === 'x-test-id' ? id : undefined) };
    limiter(req, res, (error) => (error ? reject(error) : resolve({ status: 200, headers, body: null })));
  });
  return { limiter, post };
}

beforeEach(() => {
  fake = new FakeRedis();
  redisLib.setRedisClientForTests(fake);
});

afterEach(() => redisLib.setRedisClientForTests(null));

test('allows requests up to the limit, then returns 429 with Retry-After and an error body', async () => {
  const a = startInstance({ limit: 3 });
  for (let i = 1; i <= 3; i += 1) {
    const ok = await a.post();
    assert.equal(ok.status, 200, `request ${i}`);
    assert.equal(ok.headers.get('ratelimit-policy'), '3;w=1');
    assert.match(ok.headers.get('ratelimit'), new RegExp(`limit=3, remaining=${3 - i}, reset=\\d+`));
  }
  const blocked = await a.post();
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.body, { error: { message: 'Too many login attempts. Try again later.' } });
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.match(blocked.headers.get('ratelimit'), /remaining=0/);
});

test('the limit is shared across backend instances (distributed)', async () => {
  const a = startInstance({ limit: 3 });
  const b = startInstance({ limit: 3 });
  assert.equal((await a.post()).status, 200);
  assert.equal((await b.post()).status, 200);
  assert.equal((await a.post()).status, 200);
  // Three requests were spread over two instances; the fourth is refused no matter where it lands.
  assert.equal((await b.post()).status, 429);
  assert.equal((await a.post()).status, 429);
});

test('concurrent requests across instances never exceed the limit', async () => {
  const a = startInstance({ limit: 5 });
  const b = startInstance({ limit: 5 });
  const responses = await Promise.all(
    Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).post('burst')),
  );
  const statuses = responses.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 5);
  assert.equal(statuses.filter((s) => s === 429).length, 25);
});

test('different identities have independent budgets', async () => {
  const a = startInstance({ limit: 1 });
  assert.equal((await a.post('alice')).status, 200);
  assert.equal((await a.post('alice')).status, 429);
  assert.equal((await a.post('bob')).status, 200);
});

test('the window resets after it expires', async () => {
  const a = startInstance({ limit: 1, windowMs: 1000 });
  assert.equal((await a.post()).status, 200);
  assert.equal((await a.post()).status, 429);
  fake.advance(1001);
  assert.equal((await a.post()).status, 200);
});

test('every counter key has an expiry, and raw identities never appear in Redis keys', async () => {
  const a = startInstance({ limit: 3, windowMs: 5000 });
  const identity = 'victim+tag@example.com\r\nSET evil 1';
  await a.post(identity);
  const keys = fake.keys().filter((key) => key.includes(':ratelimit:'));
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes('victim'), 'identity must be hashed');
  assert.ok(!/[\s]/.test(keys[0]), 'no whitespace in key');
  const ttl = fake.ttlMs(keys[0]);
  assert.ok(ttl > 0 && ttl <= 5000, `ttl was ${ttl}`);
});

test('byUser keys the budget on the account, not the network address', () => {
  assert.equal(byUser({ user: { id: '42' }, ip: '1.2.3.4' }), 'user:42');
  assert.equal(byUser({ ip: '1.2.3.4' }), 'ip:1.2.3.4');
});

test('Redis down: degrades to a per-instance limit, still returns 429, never a 5xx', async () => {
  const a = startInstance({ limit: 2 });
  fake.failing = true;
  const statuses = [];
  for (let i = 0; i < 4; i += 1) {
    const response = await a.post();
    statuses.push(response.status);
    assert.equal(response.headers.get('x-ratelimit-mode'), 'degraded');
  }
  assert.deepEqual(statuses, [200, 200, 429, 429]);
});

test('Redis stalled: commands time out quickly and the limiter falls back instead of hanging', async () => {
  const a = startInstance({ limit: 2 });
  fake.hanging = true;
  const started = Date.now();
  const first = await a.post();
  assert.equal(first.status, 200);
  assert.ok(Date.now() - started < 1500, 'request must not wait on a stalled Redis');
  assert.equal(first.headers.get('x-ratelimit-mode'), 'degraded');
});

test('Redis recovers: the shared budget is used again', async () => {
  const a = startInstance({ limit: 2 });
  const b = startInstance({ limit: 2 });
  fake.failing = true;
  assert.equal((await a.post()).headers.get('x-ratelimit-mode'), 'degraded');
  fake.failing = false;
  await new Promise((resolve) => setTimeout(resolve, 150)); // let the circuit breaker cool down
  const viaB = await b.post('shared');
  assert.equal(viaB.headers.get('x-ratelimit-mode'), undefined);
  assert.equal((await a.post('shared')).status, 200);
  assert.equal((await b.post('shared')).status, 429);
});
