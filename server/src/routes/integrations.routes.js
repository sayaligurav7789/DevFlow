import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess.js';
import {
  disconnectIntegration, getGitHubProjectActivity, getGitHubWorkflowRuns,
  getIntegrations, linkGitHubRepository, listGitHubRepositories,
  listSlackChannels, oauthCallback, saveSlackSettings, sendSlackTest, startOAuth,
} from '../controllers/integrations.controller.js';

const router = Router();

function requireWorkspaceManager(req, res, next) {
  if (!['owner', 'admin'].includes(req.workspace?.role)) {
    return res.status(403).json({ error: { message: 'Only workspace owners and admins can manage integrations.' } });
  }
  return next();
}

// Provider callbacks are top-level because the provider redirects to a fixed callback URL.
// The existing session cookie identifies the user who initiated the OAuth flow.
router.get('/oauth/:provider/callback', requireAuth, oauthCallback);

router.use('/workspaces/:workspaceId', requireAuth, requireWorkspaceAccess);
router.get('/workspaces/:workspaceId', getIntegrations);
router.get('/workspaces/:workspaceId/connect/:provider', requireWorkspaceManager, startOAuth);
router.delete('/workspaces/:workspaceId/:provider', requireWorkspaceManager, disconnectIntegration);
router.get('/workspaces/:workspaceId/github/repositories', listGitHubRepositories);
router.post('/workspaces/:workspaceId/github/repositories', requireWorkspaceManager, linkGitHubRepository);
router.get('/workspaces/:workspaceId/github/activity', getGitHubProjectActivity);
router.get('/workspaces/:workspaceId/github/workflows', getGitHubWorkflowRuns);
router.get('/workspaces/:workspaceId/slack/channels', listSlackChannels);
router.put('/workspaces/:workspaceId/slack/settings', requireWorkspaceManager, saveSlackSettings);
router.post('/workspaces/:workspaceId/slack/test', sendSlackTest);

export default router;
