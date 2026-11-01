import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import workspaceRoutes from './workspaces.routes.js';
import invitationRoutes from './invitations.routes.js';
import taskRoutes from './tasks.routes.js';
import projectViewRoutes from './projectViews.routes.js';
import notificationRoutes from './notifications.routes.js';
import collaborationRoutes from './collaboration.routes.js';
import integrationsRoutes from './integrations.routes.js';
import aiRoutes from './ai.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/ai/workspaces', aiRoutes);
router.use('/auth', authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/invitations', invitationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/collaboration', collaborationRoutes);
router.use('/projects/:projectId/tasks', taskRoutes);
router.use('/projects/:projectId', projectViewRoutes);

export default router;
