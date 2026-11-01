// Runs the deadline sweep on a timer inside each API process.
//
// Several instances may run this at once. That is safe (the sweep is idempotent in PostgreSQL), but
// wasteful, so each run first tries to take a short Redis lock (SET NX PX) and skips if another
// instance already swept this interval. If Redis is down the lock is skipped and the sweep runs
// anyway: correctness never depends on Redis.
import { config } from '../config/env.js';
import { redisCall, redisKey } from '../lib/redis.js';
import { generateDeadlineNotifications } from '../services/deadlineNotifications.service.js';
import { logger } from '../utils/logger.js';

const INITIAL_DELAY_MS = 10_000;
// Atomic "SET key value NX PX ttl". Done in Lua so it does not depend on the client library's
// SET option syntax, which differs between node-redis major versions.
const LOCK_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return 1 end
return 0
`;
let timer = null;
let running = false;

async function acquireSweepLock() {
  const ttlMs = Math.max(1000, Math.floor(config.notifications.deadlineSweepIntervalMs / 2));
  try {
    const acquired = await redisCall('sweep lock', (redis) => redis.eval(LOCK_SCRIPT, {
      keys: [redisKey('lock', 'deadline-sweep')],
      arguments: [String(process.pid), String(ttlMs)],
    }));
    return Number(acquired) === 1;
  } catch {
    return true; // Redis unavailable: run anyway, the sweep is idempotent.
  }
}

export async function runDeadlineSweep() {
  if (running) return null;
  running = true;
  try {
    if (!(await acquireSweepLock())) return null;
    const result = await generateDeadlineNotifications();
    if (result.dueSoon || result.overdue) {
      logger.info(`Deadline sweep created ${result.dueSoon} due-soon and ${result.overdue} overdue notifications`);
    }
    return result;
  } catch (error) {
    logger.error('Deadline sweep failed:', error.message);
    return null;
  } finally {
    running = false;
  }
}

export function startDeadlineScheduler() {
  if (timer || !config.notifications.deadlineSweepEnabled) return;
  const schedule = (delay) => {
    timer = setTimeout(async () => {
      await runDeadlineSweep();
      schedule(config.notifications.deadlineSweepIntervalMs);
    }, delay);
    timer.unref();
  };
  schedule(INITIAL_DELAY_MS);
}

export function stopDeadlineScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
}
