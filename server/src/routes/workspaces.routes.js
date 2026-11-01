import { Router } from 'express';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  updateMemberRole,
  updateWorkspace,
} from '../controllers/workspaces.controller.js';
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
} from '../controllers/invitations.controller.js';
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  restoreProject,
  updateProject,
} from '../controllers/projects.controller.js';
import { listWorkspaceActivity } from '../controllers/activity.controller.js';
import { getDashboard } from '../controllers/dashboard.controller.js';
import { listWorkspaceTasks } from '../controllers/tasks.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess.js';
import {
  destructiveActionLimiter,
  invitationCreateLimiter,
  memberManagementLimiter,
} from '../middleware/rateLimit.js';

const router = Router();

router.use(requireAuth);
router.get('/', listWorkspaces);
router.post('/', createWorkspace);

router.use('/:workspaceId', requireWorkspaceAccess);
router.get('/:workspaceId', getWorkspace);
router.patch('/:workspaceId', updateWorkspace);
router.delete('/:workspaceId', destructiveActionLimiter, deleteWorkspace);
router.get('/:workspaceId/members', listWorkspaceMembers);
router.patch('/:workspaceId/members/:userId', memberManagementLimiter, updateMemberRole);
router.delete('/:workspaceId/members/:userId', memberManagementLimiter, removeWorkspaceMember);
router.get('/:workspaceId/invitations', listInvitations);
router.post('/:workspaceId/invitations', invitationCreateLimiter, createInvitation);
router.delete('/:workspaceId/invitations/:invitationId', revokeInvitation);
router.get('/:workspaceId/tasks', listWorkspaceTasks);
router.get('/:workspaceId/dashboard', getDashboard);
router.get('/:workspaceId/activity', listWorkspaceActivity);
router.get('/:workspaceId/projects', listProjects);
router.post('/:workspaceId/projects', createProject);
router.get('/:workspaceId/projects/:projectId', getProject);
router.patch('/:workspaceId/projects/:projectId', updateProject);
router.post('/:workspaceId/projects/:projectId/archive', archiveProject);
router.post('/:workspaceId/projects/:projectId/restore', restoreProject);
router.delete('/:workspaceId/projects/:projectId', destructiveActionLimiter, deleteProject);

export default router;
