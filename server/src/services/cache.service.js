// Dashboard analytics cache (Redis). PostgreSQL remains the source of truth.
//
// Key layout (every key carries the workspace id, and the user id where the payload is per-user):
//   <prefix>:dashboard:ver:ws:<workspaceId>                          -> current version token
//   <prefix>:dashboard:ws:<workspaceId>:u:<userId>:<utcDay>:<token>  -> cached JSON payload
//
// Invalidation replaces the workspace's version token. Entries written under an older token are
// never read again and simply expire, so invalidation is one O(1) command (no KEYS/SCAN), it is
// atomic across backend instances, and a reader that raced a writer can only ever store its result
// under a token that is already dead.
//
// Authorization is NOT cached. requireWorkspaceAccess checks membership in PostgreSQL on every
// request before the controller asks this service for anything, so a removed member gets a 404
// even while their cached entry is still alive. The stored envelope additionally records the
// workspace and user it was built for and is rejected on mismatch (defence in depth).
import { randomBytes } from 'node:crypto';
import { config } from '../config/env.js';
import { redisCall, redisKey } from '../lib/redis.js';
import { logger } from '../utils/logger.js';

// The version key must outlive any data entry that could be stored under it (data TTL <= 1 hour).
const VERSION_TTL_SECONDS = 24 * 60 * 60;
const NO_VERSION = '0';

function versionKey(workspaceId) {
  return redisKey('dashboard', 'ver', 'ws', workspaceId);
}

// Overdue and "upcoming" figures depend on today's UTC date, so the date is part of the key and
// yesterday's numbers can never be served after midnight regardless of TTL.
function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function dataKey(workspaceId, userId, version, now) {
  return redisKey('dashboard', 'ws', workspaceId, 'u', userId, utcDay(now), version);
}

export function dashboardCacheKeyParts() {
  // Exposed so tests can assert on the key shape without re-deriving it.
  return { versionKey, dataKey };
}

// Returns { status: 'hit', payload } | { status: 'miss', version } | { status: 'bypass' }.
// 'bypass' means Redis could not be used; the caller must read PostgreSQL and should not write back.
export async function readDashboardCache(workspaceId, userId, now = new Date()) {
  try {
    const version = (await redisCall('GET dashboard version', (redis) => redis.get(versionKey(workspaceId)))) ?? NO_VERSION;
    const raw = await redisCall('GET dashboard', (redis) => redis.get(dataKey(workspaceId, userId, version, now)));
    if (raw) {
      try {
        const entry = JSON.parse(raw);
        if (
          entry
          && String(entry.workspaceId) === String(workspaceId)
          && String(entry.userId) === String(userId)
          && entry.payload
        ) {
          return { status: 'hit', payload: entry.payload };
        }
        logger.warn('Discarded a dashboard cache entry whose scope did not match the request');
      } catch {
        logger.warn('Discarded an unparseable dashboard cache entry');
      }
    }
    return { status: 'miss', version };
  } catch {
    return { status: 'bypass' };
  }
}

// Best effort: a failed write only means the next request recomputes from PostgreSQL.
export async function writeDashboardCache(workspaceId, userId, version, payload, now = new Date()) {
  const entry = JSON.stringify({ workspaceId: String(workspaceId), userId: String(userId), payload });
  try {
    await redisCall('SETEX dashboard', (redis) => redis.setEx(
      dataKey(workspaceId, userId, version, now),
      config.cache.dashboardTtlSeconds,
      entry,
    ));
    return true;
  } catch {
    return false;
  }
}

// Call after the PostgreSQL transaction that changed workspace data has committed. Never throws:
// if Redis is down the write already succeeded, and the short TTL bounds how long a stale entry can
// survive. Returns whether the invalidation reached Redis.
export async function invalidateWorkspaceDashboard(workspaceId) {
  if (workspaceId === undefined || workspaceId === null) return false;
  const token = `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
  try {
    await redisCall('SETEX dashboard version', (redis) => redis.setEx(
      versionKey(workspaceId),
      VERSION_TTL_SECONDS,
      token,
    ));
    return true;
  } catch (error) {
    logger.warn(`Dashboard cache invalidation for workspace ${workspaceId} was skipped (${error.message}); entries expire within ${config.cache.dashboardTtlSeconds}s`);
    return false;
  }
}
