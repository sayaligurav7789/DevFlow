// Distributed fixed-window rate limiter.
//
// Counters live in Redis, so every backend instance behind a load balancer shares the same budget.
// The INCR + PEXPIRE pair runs inside one Lua script, which makes the window atomic: two instances
// can never both observe "count 0" and both start a window, and a key can never be left without an
// expiry.
//
// If Redis is unreachable the limiter DEGRADES instead of failing open or closed: it keeps counting
// in a per-process map. Protection is weaker (each instance has its own budget) but brute-force
// attempts are still throttled, and no request is ever rejected just because Redis is down.
import { createHash } from 'node:crypto';
import { redisCall, redisKey } from '../lib/redis.js';

const WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if current == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

const MEMORY_SWEEP_THRESHOLD = 10_000;

function hashIdentity(identity) {
  // Bounded length and no user-controlled characters inside Redis keys.
  return createHash('sha256').update(String(identity)).digest('hex').slice(0, 32);
}

export const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

export const byIp = (req) => `ip:${clientIp(req)}`;
// For routes mounted after requireAuth: budget follows the account, not the network address.
export const byUser = (req) => (req.user?.id ? `user:${req.user.id}` : byIp(req));

export function createRateLimiter({
  name,
  windowMs,
  limit,
  message = 'Too many requests. Try again later.',
  key = byIp,
}) {
  const memory = new Map(); // identity hash -> { count, resetAt }

  function hitMemory(identity, now) {
    if (memory.size > MEMORY_SWEEP_THRESHOLD) {
      for (const [id, entry] of memory) if (entry.resetAt <= now) memory.delete(id);
    }
    let entry = memory.get(identity);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      memory.set(identity, entry);
    }
    entry.count += 1;
    return { count: entry.count, ttlMs: entry.resetAt - now, degraded: true };
  }

  async function hit(identity) {
    const now = Date.now();
    try {
      const redisIdentity = redisKey('ratelimit', name, identity);
      const [count, ttlMs] = await redisCall('rate limit', (redis) => redis.eval(WINDOW_SCRIPT, {
        keys: [redisIdentity],
        arguments: [String(windowMs)],
      }));
      return { count: Number(count), ttlMs: Math.max(0, Number(ttlMs)), degraded: false };
    } catch {
      return hitMemory(identity, now);
    }
  }

  const limiter = async function rateLimitMiddleware(req, res, next) {
    try {
      const { count, ttlMs, degraded } = await hit(hashIdentity(key(req)));
      const resetSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
      const remaining = Math.max(0, limit - count);

      res.set('RateLimit-Policy', `${limit};w=${Math.ceil(windowMs / 1000)}`);
      res.set('RateLimit', `limit=${limit}, remaining=${remaining}, reset=${resetSeconds}`);
      if (degraded) res.set('X-RateLimit-Mode', 'degraded');

      if (count > limit) {
        res.set('Retry-After', String(resetSeconds));
        return res.status(429).json({ error: { message } });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };

  // Test hooks.
  limiter.resetMemoryForTests = () => memory.clear();
  limiter.policy = Object.freeze({ name, windowMs, limit });
  return limiter;
}

// Policies. Login and registration keep their pre-Stage-8 budgets; the rest protect actions that
// are abusable (spam, token guessing) or destructive. The limits are deliberately generous for
// normal use. DEVFLOW_RATE_LIMIT_SCALE lets an operator loosen or tighten all of them at once
// (.env is already loaded: importing ../lib/redis.js pulls in config/env.js first).
const scale = Number.parseFloat(process.env.DEVFLOW_RATE_LIMIT_SCALE ?? '1');
const scaled = (limit) => Math.max(1, Math.round(limit * (Number.isFinite(scale) && scale > 0 ? scale : 1)));

export const loginLimiter = createRateLimiter({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  limit: scaled(8),
  message: 'Too many login attempts. Try again later.',
  key: byIp,
});

export const registrationLimiter = createRateLimiter({
  name: 'register',
  windowMs: 60 * 60 * 1000,
  limit: scaled(5),
  message: 'Too many registration attempts. Try again later.',
  key: byIp,
});

export const profileUpdateLimiter = createRateLimiter({
  name: 'profile-update',
  windowMs: 60 * 60 * 1000,
  limit: scaled(30),
  message: 'Too many profile changes. Try again later.',
  key: byUser,
});

export const invitationCreateLimiter = createRateLimiter({
  name: 'invitation-create',
  windowMs: 60 * 60 * 1000,
  limit: scaled(60),
  message: 'Too many invitations sent. Try again later.',
  key: byUser,
});

export const invitationAcceptLimiter = createRateLimiter({
  name: 'invitation-accept',
  windowMs: 15 * 60 * 1000,
  limit: scaled(20),
  message: 'Too many invitation attempts. Try again later.',
  key: byUser,
});

export const memberManagementLimiter = createRateLimiter({
  name: 'member-management',
  windowMs: 60 * 60 * 1000,
  limit: scaled(120),
  message: 'Too many membership changes. Try again later.',
  key: byUser,
});

export const destructiveActionLimiter = createRateLimiter({
  name: 'destructive',
  windowMs: 60 * 60 * 1000,
  limit: scaled(60),
  message: 'Too many delete actions. Try again later.',
  key: byUser,
});

export const passwordResetLimiter = createRateLimiter({
  name: 'password-reset', windowMs: 60 * 60 * 1000, limit: scaled(5),
  message: 'Too many password reset requests. Try again later.', key: byIp,
});
export const accountActionLimiter = createRateLimiter({
  name: 'account-action', windowMs: 15 * 60 * 1000, limit: scaled(8),
  message: 'Too many account security requests. Try again later.', key: byUser,
});
