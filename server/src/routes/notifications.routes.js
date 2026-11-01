import { Router } from 'express';
import {
  getUnreadCount,
  listMyNotifications,
  markAllRead,
  markRead,
} from '../controllers/notifications.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// Every route is scoped to the signed-in user; there is no workspace-wide notification feed.
router.use(requireAuth);
router.get('/', listMyNotifications);
router.get('/unread-count', getUnreadCount);
router.post('/read-all', markAllRead);
router.post('/:notificationId/read', markRead);

export default router;
