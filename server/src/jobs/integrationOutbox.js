import { pool } from '../db/pool.js';
import { decryptSecret } from '../services/integrations.service.js';
import { logger } from '../utils/logger.js';

let timer = null;
let running = false;

async function claimBatch() {
  const result = await pool.query(
    `UPDATE integration_outbox
     SET locked_at = NOW()
     WHERE id IN (
       SELECT id FROM integration_outbox
       WHERE delivered_at IS NULL AND attempts < 8 AND available_at <= NOW()
         AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
       ORDER BY id
       LIMIT 10
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, workspace_id, event_type, payload, attempts`,
  );
  return result.rows;
}

async function deliver(row) {
  const [connection, settings, context] = await Promise.all([
    pool.query(
      `SELECT access_token_encrypted FROM integration_connections
       WHERE workspace_id = $1 AND provider = 'slack'`,
      [row.workspace_id],
    ),
    pool.query(
      `SELECT channel_id, events FROM integration_notification_settings
       WHERE workspace_id = $1 AND provider = 'slack'`,
      [row.workspace_id],
    ),
    pool.query(
      `SELECT w.name AS workspace_name, p.name AS project_name
       FROM workspaces w LEFT JOIN projects p ON p.id = $2
       WHERE w.id = $1`,
      [row.workspace_id, row.payload.projectId || null],
    ),
  ]);

  if (!connection.rowCount || !settings.rowCount || !settings.rows[0].events.includes(row.event_type)) {
    await pool.query('UPDATE integration_outbox SET delivered_at = NOW(), locked_at = NULL WHERE id = $1', [row.id]);
    return;
  }

  const token = decryptSecret(connection.rows[0].access_token_encrypted);
  const projectName = context.rows[0]?.project_name || 'a project';
  const workspaceName = context.rows[0]?.workspace_name || 'your workspace';
  const taskTitle = String(row.payload.taskTitle || 'Task').slice(0, 180);
  const text = row.event_type === 'task_assigned'
    ? `:busts_in_silhouette: *Task assigned* in *${workspaceName}*\n*${taskTitle}* · ${projectName}\nAssigned by ${row.payload.actorName || 'a teammate'}.`
    : `:white_check_mark: *Task completed* in *${workspaceName}*\n*${taskTitle}* · ${projectName}\nUpdated by ${row.payload.actorName || 'a teammate'}.`;

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: settings.rows[0].channel_id, text }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Slack API returned ${response.status}.`);
  await pool.query('UPDATE integration_outbox SET delivered_at = NOW(), locked_at = NULL, last_error = NULL WHERE id = $1', [row.id]);
}

async function processRow(row) {
  try {
    await deliver(row);
  } catch (error) {
    const attempts = row.attempts + 1;
    const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(attempts, 7)));
    await pool.query(
      `UPDATE integration_outbox
       SET attempts = $2, available_at = NOW() + ($3 * INTERVAL '1 second'),
           locked_at = NULL, last_error = LEFT($4, 500)
       WHERE id = $1`,
      [row.id, attempts, delaySeconds, error.message],
    );
    logger.warn(`Slack integration delivery ${row.id} failed (attempt ${attempts}): ${error.message}`);
  }
}

export async function processIntegrationOutbox() {
  if (running) return;
  running = true;
  try {
    const batch = await claimBatch();
    for (const row of batch) await processRow(row);
  } catch (error) {
    logger.error('Integration outbox processing failed:', error.message);
  } finally {
    running = false;
  }
}

export function startIntegrationOutbox(intervalMs = 5000) {
  if (timer) return;
  timer = setInterval(() => { void processIntegrationOutbox(); }, intervalMs);
  timer.unref?.();
  void processIntegrationOutbox();
}

export function stopIntegrationOutbox() {
  if (timer) clearInterval(timer);
  timer = null;
}
