import { pool } from '../db/pool.js';
import { config } from '../config/env.js';
import {
  createOAuthState, decryptSecret, encryptSecret, providerFetch, sha256,
} from '../services/integrations.service.js';

const PROVIDERS = new Set(['github', 'slack']);
const FRONTEND = config.clientOrigin;

function fail(res, status, message) {
  return res.status(status).json({ error: { message } });
}
function integrationConfig(provider) {
  return config.integrations[provider];
}
function callbackUrl(provider) {
  return `${config.apiOrigin}/api/integrations/oauth/${provider}/callback`;
}
function requireProviderConfig(provider) {
  const values = integrationConfig(provider);
  if (!/^[a-f0-9]{64}$/i.test(config.integrations.encryptionKey)) {
    const error = new Error('INTEGRATIONS_ENCRYPTION_KEY must be configured as 64 hexadecimal characters.');
    error.status = 503;
    throw error;
  }
  if (!values?.clientId || !values?.clientSecret) {
    const error = new Error(`${provider} OAuth is not configured. Add its client ID and secret to server/.env.`);
    error.status = 503;
    throw error;
  }
  return values;
}
async function connection(workspaceId, provider) {
  const result = await pool.query(
    `SELECT * FROM integration_connections WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
  return result.rows[0] || null;
}
function safeConnection(row) {
  if (!row) return null;
  return {
    provider: row.provider,
    connected: true,
    accountName: row.external_account_name,
    accountId: row.external_account_id,
    scopes: row.scopes,
    connectedAt: row.created_at,
    metadata: row.metadata,
  };
}
async function providerRequest(url, token, options) {
  try { return await providerFetch(url, token, options); }
  catch (error) {
    if (error.status === 401) error.message = 'The provider authorization expired or was revoked. Disconnect and reconnect the integration.';
    throw error;
  }
}

export async function getIntegrations(req, res, next) {
  try {
    const [connections, repos, slack] = await Promise.all([
      pool.query(
        `SELECT * FROM integration_connections WHERE workspace_id = $1 ORDER BY provider`,
        [req.params.workspaceId],
      ),
      pool.query(
        `SELECT pi.id, pi.project_id AS "projectId", p.name AS "projectName",
                pi.repository_full_name AS "repositoryFullName", pi.default_branch AS "defaultBranch"
         FROM project_integrations pi JOIN projects p ON p.id = pi.project_id
         WHERE pi.workspace_id = $1 ORDER BY p.name`,
        [req.params.workspaceId],
      ),
      pool.query(
        `SELECT channel_id AS "channelId", channel_name AS "channelName", events
         FROM integration_notification_settings WHERE workspace_id = $1 AND provider = 'slack'`,
        [req.params.workspaceId],
      ),
    ]);
    res.json({
      integrations: Object.fromEntries(['github', 'slack'].map((provider) => [
        provider, safeConnection(connections.rows.find((row) => row.provider === provider)),
      ])),
      repositories: repos.rows,
      slackSettings: slack.rows[0] || null,
      capabilities: { githubActions: Boolean(connections.rows.find((row) => row.provider === 'github')) },
    });
  } catch (error) { next(error); }
}

export async function startOAuth(req, res, next) {
  try {
    const { provider } = req.params;
    if (!PROVIDERS.has(provider)) return fail(res, 404, 'Unsupported integration provider.');
    const oauth = requireProviderConfig(provider);
    const state = createOAuthState();
    await pool.query(
      `DELETE FROM integration_oauth_states WHERE expires_at < NOW()`,
    );
    await pool.query(
      `INSERT INTO integration_oauth_states (state_hash, workspace_id, user_id, provider, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')`,
      [sha256(state), req.params.workspaceId, req.user.id, provider],
    );
    const redirect = callbackUrl(provider);
    let url;
    if (provider === 'github') {
      url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', oauth.clientId);
      url.searchParams.set('redirect_uri', redirect);
      url.searchParams.set('scope', 'repo read:user');
      url.searchParams.set('state', state);
    } else {
      url = new URL('https://slack.com/oauth/v2/authorize');
      url.searchParams.set('client_id', oauth.clientId);
      url.searchParams.set('redirect_uri', redirect);
      url.searchParams.set('scope', 'chat:write,channels:read,groups:read');
      url.searchParams.set('state', state);
    }
    return res.redirect(url.toString());
  } catch (error) {
    if (error.status) return fail(res, error.status, error.message);
    return next(error);
  }
}

export async function oauthCallback(req, res) {
  const { provider } = req.params;
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');
  const fallback = `${FRONTEND}/workspaces`;
  if (!PROVIDERS.has(provider) || !state || !code || req.query.error) {
    return res.redirect(`${fallback}?integration_error=${encodeURIComponent(String(req.query.error || 'OAuth was cancelled or returned invalid parameters.'))}`);
  }

  let callbackWorkspaceId = null;
  try {
    const stateResult = await pool.query(
      `DELETE FROM integration_oauth_states
       WHERE state_hash = $1 AND provider = $2 AND user_id = $3 AND expires_at > NOW()
       RETURNING workspace_id`,
      [sha256(state), provider, req.user.id],
    );
    if (!stateResult.rowCount) {
      return res.redirect(`${fallback}?integration_error=${encodeURIComponent('OAuth state expired or did not match this account. Please try again.')}`);
    }
    const workspaceId = stateResult.rows[0].workspace_id;
    callbackWorkspaceId = workspaceId;
    const stillMember = await pool.query(
      `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, req.user.id],
    );
    if (!stillMember.rowCount) return res.redirect(`${fallback}?integration_error=${encodeURIComponent('You no longer have access to that workspace.')}`);
    const oauth = requireProviderConfig(provider);
    const redirectUri = callbackUrl(provider);
    let token;
    let accountId;
    let accountName;
    let scopes = [];
    let metadata = {};

    if (provider === 'github') {
      const tokenData = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: oauth.clientId, client_secret: oauth.clientSecret,
          code, redirect_uri: redirectUri, state,
        }),
      }).then((r) => r.json());
      if (!tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || 'GitHub token exchange failed.');
      token = tokenData.access_token;
      scopes = String(tokenData.scope || '').split(',').filter(Boolean);
      const user = await providerRequest('https://api.github.com/user', token, {
        headers: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DevFlow' },
      });
      accountId = String(user.id);
      accountName = user.login;
      metadata = { avatarUrl: user.avatar_url, htmlUrl: user.html_url };
    } else {
      const tokenData = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: oauth.clientId, client_secret: oauth.clientSecret,
          code, redirect_uri: redirectUri,
        }),
      }).then((r) => r.json());
      if (!tokenData.ok) throw new Error(tokenData.error || 'Slack token exchange failed.');
      token = tokenData.access_token;
      accountId = tokenData.team?.id || tokenData.enterprise?.id || '';
      accountName = tokenData.team?.name || 'Slack workspace';
      scopes = String(tokenData.scope || '').split(',').filter(Boolean);
      metadata = { teamId: accountId, botUserId: tokenData.bot_user_id || null };
    }

    await pool.query(
      `INSERT INTO integration_connections
        (workspace_id, provider, connected_by, external_account_id, external_account_name,
         access_token_encrypted, scopes, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET
         connected_by = EXCLUDED.connected_by,
         external_account_id = EXCLUDED.external_account_id,
         external_account_name = EXCLUDED.external_account_name,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = NULL,
         scopes = EXCLUDED.scopes,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [workspaceId, provider, req.user.id, accountId, accountName, encryptSecret(token), scopes, JSON.stringify(metadata)],
    );
    return res.redirect(`${FRONTEND}/workspaces/${workspaceId}/integrations?connected=${provider}`);
  } catch (error) {
    const destination = callbackWorkspaceId ? `${FRONTEND}/workspaces/${callbackWorkspaceId}/integrations` : fallback;
    return res.redirect(`${destination}?integration_error=${encodeURIComponent(error.message || 'Unable to connect integration.')}`);
  }
}

export async function disconnectIntegration(req, res, next) {
  try {
    const { provider } = req.params;
    if (!PROVIDERS.has(provider)) return fail(res, 404, 'Unsupported integration provider.');
    await pool.query(
      `DELETE FROM integration_connections WHERE workspace_id = $1 AND provider = $2`,
      [req.params.workspaceId, provider],
    );
    if (provider === 'github') {
      await pool.query(`DELETE FROM project_integrations WHERE workspace_id = $1`, [req.params.workspaceId]);
    }
    if (provider === 'slack') {
      await pool.query(`DELETE FROM integration_notification_settings WHERE workspace_id = $1`, [req.params.workspaceId]);
    }
    res.status(204).end();
  } catch (error) { next(error); }
}

export async function listGitHubRepositories(req, res, next) {
  try {
    const row = await connection(req.params.workspaceId, 'github');
    if (!row) return fail(res, 409, 'Connect GitHub before loading repositories.');
    const token = decryptSecret(row.access_token_encrypted);
    const repos = await providerRequest('https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member', token, {
      headers: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DevFlow' },
    });
    res.json({ repositories: repos.map((repo) => ({
      id: String(repo.id), fullName: repo.full_name, name: repo.name,
      owner: repo.owner?.login, private: repo.private,
      defaultBranch: repo.default_branch, htmlUrl: repo.html_url,
      description: repo.description,
    })) });
  } catch (error) { next(error); }
}

export async function linkGitHubRepository(req, res, next) {
  try {
    const { projectId, repository } = req.body || {};
    if (!/^\d+$/.test(String(projectId || '')) || !repository?.id || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.fullName || '')) {
      return fail(res, 400, 'A valid project and repository are required.');
    }
    const project = await pool.query(
      `SELECT id FROM projects WHERE id = $1 AND workspace_id = $2`,
      [projectId, req.params.workspaceId],
    );
    if (!project.rowCount) return fail(res, 404, 'Project not found in this workspace.');
    const result = await pool.query(
      `INSERT INTO project_integrations
        (workspace_id, project_id, provider, external_repository_id, repository_full_name, default_branch, linked_by)
       VALUES ($1, $2, 'github', $3, $4, $5, $6)
       ON CONFLICT (project_id, provider) DO UPDATE SET
         external_repository_id = EXCLUDED.external_repository_id,
         repository_full_name = EXCLUDED.repository_full_name,
         default_branch = EXCLUDED.default_branch,
         linked_by = EXCLUDED.linked_by
       RETURNING id, project_id AS "projectId", repository_full_name AS "repositoryFullName", default_branch AS "defaultBranch"`,
      [req.params.workspaceId, projectId, String(repository.id), repository.fullName, repository.defaultBranch || 'main', req.user.id],
    );
    res.status(201).json({ repository: result.rows[0] });
  } catch (error) { next(error); }
}

async function linkedRepo(req) {
  if (!/^\d+$/.test(String(req.query.projectId || ''))) return null;
  const result = await pool.query(
    `SELECT pi.*, c.access_token_encrypted
     FROM project_integrations pi
     JOIN integration_connections c ON c.workspace_id = pi.workspace_id AND c.provider = 'github'
     WHERE pi.workspace_id = $1 AND pi.project_id = $2`,
    [req.params.workspaceId, req.query.projectId],
  );
  return result.rows[0] || null;
}
export async function getGitHubProjectActivity(req, res, next) {
  try {
    const linked = await linkedRepo(req);
    if (!linked) return fail(res, 404, 'Link a GitHub repository to this project first.');
    const token = decryptSecret(linked.access_token_encrypted);
    const [commits, pulls, issues] = await Promise.all([
      providerRequest(`https://api.github.com/repos/${linked.repository_full_name}/commits?per_page=8`, token, { headers: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DevFlow' } }),
      providerRequest(`https://api.github.com/repos/${linked.repository_full_name}/pulls?state=all&per_page=8`, token, { headers: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DevFlow' } }),
      providerRequest(`https://api.github.com/repos/${linked.repository_full_name}/issues?state=all&per_page=8`, token, { headers: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DevFlow' } }),
    ]);
    res.json({
      commits: commits.map((c) => ({ sha: c.sha, message: c.commit?.message?.split('\n')[0], author: c.commit?.author?.name, date: c.commit?.author?.date, url: c.html_url })),
      pullRequests: pulls.map((p) => ({ id: p.id, number: p.number, title: p.title, state: p.state, draft: p.draft, url: p.html_url, updatedAt: p.updated_at })),
      issues: issues.filter((i) => !i.pull_request).map((i) => ({ id: i.id, number: i.number, title: i.title, state: i.state, url: i.html_url, updatedAt: i.updated_at })),
    });
  } catch (error) { next(error); }
}

export async function getGitHubWorkflowRuns(req, res, next) {
  try {
    const linked = await linkedRepo(req);
    if (!linked) return fail(res, 404, 'Link a GitHub repository to this project first.');
    const token = decryptSecret(linked.access_token_encrypted);
    const data = await providerRequest(`https://api.github.com/repos/${linked.repository_full_name}/actions/runs?per_page=15`, token, {
      headers: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DevFlow' },
    });
    res.json({ workflowRuns: (data.workflow_runs || []).map((run) => ({
      id: run.id, name: run.name, displayTitle: run.display_title,
      status: run.status, conclusion: run.conclusion,
      branch: run.head_branch, event: run.event, url: run.html_url,
      createdAt: run.created_at, updatedAt: run.updated_at,
    })) });
  } catch (error) { next(error); }
}

export async function listSlackChannels(req, res, next) {
  try {
    const row = await connection(req.params.workspaceId, 'slack');
    if (!row) return fail(res, 409, 'Connect Slack before loading channels.');
    const token = decryptSecret(row.access_token_encrypted);
    const data = await providerRequest('https://slack.com/api/conversations.list?exclude_archived=true&limit=200&types=public_channel,private_channel', token);
    if (!data.ok) return fail(res, 502, data.error || 'Unable to load Slack channels.');
    res.json({ channels: (data.channels || []).map((c) => ({ id: c.id, name: c.name, isPrivate: c.is_private })) });
  } catch (error) { next(error); }
}

export async function saveSlackSettings(req, res, next) {
  try {
    const { channelId, channelName, events } = req.body || {};
    const allowed = new Set(['task_assigned', 'task_completed']);
    if (typeof channelId !== 'string' || !channelId || typeof channelName !== 'string' || !Array.isArray(events) || events.some((e) => !allowed.has(e))) {
      return fail(res, 400, 'Select a valid Slack channel and notification events.');
    }
    const row = await connection(req.params.workspaceId, 'slack');
    if (!row) return fail(res, 409, 'Connect Slack before configuring notifications.');
    await pool.query(
      `INSERT INTO integration_notification_settings (workspace_id, provider, channel_id, channel_name, events, updated_by)
       VALUES ($1, 'slack', $2, $3, $4, $5)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET
         channel_id = EXCLUDED.channel_id, channel_name = EXCLUDED.channel_name,
         events = EXCLUDED.events, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [req.params.workspaceId, channelId, channelName, events, req.user.id],
    );
    res.json({ saved: true });
  } catch (error) { next(error); }
}

export async function sendSlackTest(req, res, next) {
  try {
    const row = await connection(req.params.workspaceId, 'slack');
    if (!row) return fail(res, 409, 'Connect Slack before sending a test message.');
    const settings = await pool.query(
      `SELECT channel_id, channel_name FROM integration_notification_settings WHERE workspace_id = $1 AND provider = 'slack'`,
      [req.params.workspaceId],
    );
    if (!settings.rowCount) return fail(res, 409, 'Choose a Slack channel first.');
    const token = decryptSecret(row.access_token_encrypted);
    const data = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        channel: settings.rows[0].channel_id,
        text: `DevFlow is connected to this channel. Test message sent by ${req.user.displayName}.`,
      }),
    }).then((r) => r.json());
    if (!data.ok) return fail(res, 502, data.error || 'Slack could not send the test message.');
    res.json({ sent: true, channel: settings.rows[0].channel_name });
  } catch (error) { next(error); }
}
