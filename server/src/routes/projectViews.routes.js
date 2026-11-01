import { Router } from 'express';
import { listProjectActivity } from '../controllers/activity.controller.js';
import { getBoard } from '../controllers/tasks.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

// Read-only project views mounted at /api/projects/:projectId
const router = Router({ mergeParams: true });

router.use(requireAuth);
router.get('/board', getBoard);
router.get('/activity', listProjectActivity);

export default router;
