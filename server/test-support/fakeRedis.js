// In-memory stand-in for the subset of node-redis that Stage 8 uses: get, setEx, eval.
//
// It is a test double, not Redis. The two Lua scripts (rate-limit window, sweep lock) are
// recognised by their commands and re-implemented in JavaScript with the same semantics, so these
// tests prove the application logic (key layout, TTLs, invalidation, fallback), NOT the Lua code
// itself. test/redis-integration.test.js runs the real scripts when DEVFLOW_TEST_REDIS_URL is set.
//
// Controls:
//   fake.failing = true   every command rejects (connection refused)
//   fake.hanging = true   every command never answers (stalled server)
//   fake.advance(ms)      move the fake clock forward (expires keys)
export class FakeRedis {
  constructor() {
    this.isReady = true;
    this.failing = false;
    this.hanging = false;
    this.commandCount = 0;
    this.store = new Map(); // key -> { value, expiresAt | null }
    this.offsetMs = 0;
  }

  now() {
    return Date.now() + this.offsetMs;
  }

  advance(ms) {
    this.offsetMs += ms;
  }

  async #enter() {
    this.commandCount += 1;
    if (this.failing) throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    if (this.hanging) await new Promise(() => {});
  }

  #live(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get(key) {
    await this.#enter();
    return this.#live(key)?.value ?? null;
  }

  async setEx(key, seconds, value) {
    await this.#enter();
    if (!Number.isInteger(seconds) || seconds <= 0) throw new Error('ERR invalid expire time in setex');
    this.store.set(key, { value: String(value), expiresAt: this.now() + seconds * 1000 });
    return 'OK';
  }

  async eval(script, { keys = [], arguments: args = [] } = {}) {
    await this.#enter();
    const [key] = keys;

    if (script.includes("'INCR'")) {
      // Rate-limit window: INCR, then PEXPIRE when the key is new or has no expiry, return { count, ttl }.
      const existing = this.#live(key);
      const count = (existing ? Number(existing.value) : 0) + 1;
      const entry = existing ?? { value: '0', expiresAt: null };
      entry.value = String(count);
      if (count === 1 || entry.expiresAt === null) entry.expiresAt = this.now() + Number(args[0]);
      this.store.set(key, entry);
      return [count, entry.expiresAt - this.now()];
    }

    if (script.includes("'NX'")) {
      // Lock: SET key value NX PX ttl.
      if (this.#live(key)) return 0;
      this.store.set(key, { value: String(args[0]), expiresAt: this.now() + Number(args[1]) });
      return 1;
    }

    throw new Error('FakeRedis: unrecognised script');
  }

  // Introspection helpers for assertions.
  keys() {
    return [...this.store.keys()].filter((key) => this.#live(key));
  }

  ttlMs(key) {
    const entry = this.#live(key);
    return entry && entry.expiresAt !== null ? entry.expiresAt - this.now() : null;
  }

  quit() {
    return Promise.resolve();
  }
}
