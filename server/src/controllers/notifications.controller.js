import { httpError } from '../utils/httpError.js';
import { isValidBigintId } from '../services/workspaceAccess.service.js';
import {
  countUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications.service.js';

const LIST_QUERY_KEYS = new Set(['unread', 'workspaceId', 'page', 'limit']);
const COUNT_QUERY_KEYS = new Set(['workspaceId']);

function assertKnownKeys(value, allowed) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw httpError(400, `Unknown query field: ${unknown}`);
}

function positiveInteger(value, fallback, maximum, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw httpError(400, `${field} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw httpError(400, `${field} must be at most ${maximum}`);
  return number;
}

function optionalWorkspaceId(value) {
  if (value === undefined) return undefined;
  if (!isValidBigintId(value)) throw httpError(400, 'workspaceId must be a valid workspace id');
  return value;
}

// GET /api/notifications?unread=true&workspaceId=&page=&limit=
// Always the caller's own notifications, newest first. `unreadCount` honours the workspaceId filter.
export async function listMyNotifications(req, res, next) {
  try {
    assertKnownKeys(req.query, LIST_QUERY_KEYS);
    const page = positiveInteger(req.query.page, 1, 1_000_000, 'page');
    const limit = positiveInteger(req.query.limit, 20, 100, 'limit');
    const workspaceId = optionalWorkspaceId(req.query.workspaceId);
    if (req.query.unread !== undefined && !['true', 'false'].includes(req.query.unread)) {
      throw httpError(400, 'unread must be true or false');
    }
    const { notifications, total } = await listNotifications(req.user.id, {
      unreadOnly: req.query.unread === 'true',
      workspaceId,
      limit,
      offset: (page - 1) * limit,
    });
    const unreadCount = await countUnread(req.user.id, { workspaceId });
    return res.json({
      notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return next(error);
  }
}

// GET /api/notifications/unread-count?workspaceId=
export async function getUnreadCount(req, res, next) {
  try {
    assertKnownKeys(req.query, COUNT_QUERY_KEYS);
    const workspaceId = optionalWorkspaceId(req.query.workspaceId);
    return res.json({ unreadCount: await countUnread(req.user.id, { workspaceId }) });
  } catch (error) {
    return next(error);
  }
}

// POST /api/notifications/:notificationId/read   (idempotent)
export async function markRead(req, res, next) {
  try {
    if (!isValidBigintId(req.params.notificationId)) throw httpError(404, 'Notification not found');
    const notification = await markNotificationRead(req.user.id, req.params.notificationId);
    if (!notification) throw httpError(404, 'Notification not found');
    return res.json({ notification });
  } catch (error) {
    return next(error);
  }
}

// POST /api/notifications/read-all   body: { workspaceId? }
export async function markAllRead(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const unknown = Object.keys(body).find((key) => key !== 'workspaceId');
    if (unknown) throw httpError(400, `Unknown field: ${unknown}`);
    const workspaceId = optionalWorkspaceId(body.workspaceId);
    const updated = await markAllNotificationsRead(req.user.id, { workspaceId });
    return res.json({ updated, unreadCount: await countUnread(req.user.id, { workspaceId }) });
  } catch (error) {
    return next(error);
  }
}
