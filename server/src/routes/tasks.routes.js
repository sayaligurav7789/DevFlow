import { Router } from 'express';
import {
  createTask,
  deleteTask,
  getTask,
  listTaskActivity,
  listTasks,
  moveTask,
  updateTask,
} from '../controllers/tasks.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.get('/', listTasks);
router.post('/', createTask);
router.get('/:taskId', getTask);
router.patch('/:taskId', updateTask);
router.delete('/:taskId', deleteTask);
router.post('/:taskId/move', moveTask);
router.get('/:taskId/activity', listTaskActivity);

export default router;
