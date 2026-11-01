import { pool } from '../db/pool.js';
import { httpError } from '../utils/httpError.js';

export async function listDiscussions(req, res) {
  const { workspaceId } = req.params;
  const projectId = req.query.projectId || null;
  if (projectId) {
    const project = await pool.query('SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$2', [projectId, workspaceId]);
    if (!project.rowCount) throw httpError(404, 'Project not found');
  }
  const result = await pool.query(
    `SELECT d.id::TEXT AS id, d.parent_id::TEXT AS "parentId", d.project_id::TEXT AS "projectId",
            d.body, d.created_at AS "createdAt", d.updated_at AS "updatedAt",
            d.author_id::TEXT AS "authorId", COALESCE(u.display_name,'Former member') AS "authorName",
            (SELECT COUNT(*)::INT FROM discussions r WHERE r.parent_id=d.id) AS "replyCount",
            (SELECT COUNT(*)::INT FROM discussion_reactions x WHERE x.discussion_id=d.id) AS "reactionCount",
            EXISTS (SELECT 1 FROM discussion_reactions x WHERE x.discussion_id=d.id AND x.user_id=$3 AND x.reaction='like') AS "likedByMe"
     FROM discussions d LEFT JOIN users u ON u.id=d.author_id
     WHERE d.workspace_id=$1 AND d.parent_id IS NULL AND ($2::BIGINT IS NULL OR d.project_id=$2)
     ORDER BY d.created_at DESC LIMIT 100`, [workspaceId, projectId, req.user.id]);
  res.json({ discussions: result.rows });
}

export async function createDiscussion(req, res) {
  const body = String(req.body?.body ?? '').trim();
  const projectId = req.body?.projectId || null;
  if (!body || body.length > 5000) throw httpError(400, 'Message must be between 1 and 5000 characters');
  if (projectId) {
    const project = await pool.query('SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$2', [projectId, req.params.workspaceId]);
    if (!project.rowCount) throw httpError(404, 'Project not found');
  }
  const result = await pool.query(
    `INSERT INTO discussions (workspace_id, project_id, author_id, body) VALUES ($1,$2,$3,$4)
     RETURNING id::TEXT AS id, parent_id::TEXT AS "parentId", project_id::TEXT AS "projectId", body, created_at AS "createdAt"`,
    [req.params.workspaceId, projectId, req.user.id, body]);
  res.status(201).json({ discussion: { ...result.rows[0], authorId: req.user.id, authorName: req.user.displayName, replyCount: 0, reactionCount: 0, likedByMe: false } });
}

export async function listReplies(req, res) {
  const result = await pool.query(
    `SELECT d.id::TEXT AS id, d.parent_id::TEXT AS "parentId", d.body, d.created_at AS "createdAt",
            d.author_id::TEXT AS "authorId", COALESCE(u.display_name,'Former member') AS "authorName"
     FROM discussions d LEFT JOIN users u ON u.id=d.author_id
     WHERE d.workspace_id=$1 AND d.parent_id=$2 ORDER BY d.created_at ASC LIMIT 100`,
    [req.params.workspaceId, req.params.discussionId]);
  res.json({ replies: result.rows });
}

export async function createReply(req, res) {
  const body = String(req.body?.body ?? '').trim();
  if (!body || body.length > 5000) throw httpError(400, 'Reply must be between 1 and 5000 characters');
  const parent = await pool.query('SELECT id, project_id FROM discussions WHERE id=$1 AND workspace_id=$2 AND parent_id IS NULL', [req.params.discussionId, req.params.workspaceId]);
  if (!parent.rowCount) throw httpError(404, 'Discussion not found');
  const result = await pool.query(
    `INSERT INTO discussions (workspace_id, project_id, author_id, parent_id, body) VALUES ($1,$2,$3,$4,$5)
     RETURNING id::TEXT AS id, parent_id::TEXT AS "parentId", body, created_at AS "createdAt"`,
    [req.params.workspaceId, parent.rows[0].project_id, req.user.id, req.params.discussionId, body]);
  res.status(201).json({ reply: { ...result.rows[0], authorId: req.user.id, authorName: req.user.displayName } });
}

export async function toggleReaction(req, res) {
  const { workspaceId, discussionId } = req.params;
  const found = await pool.query('SELECT 1 FROM discussions WHERE id=$1 AND workspace_id=$2', [discussionId, workspaceId]);
  if (!found.rowCount) throw httpError(404, 'Discussion not found');
  const existing = await pool.query("DELETE FROM discussion_reactions WHERE discussion_id=$1 AND user_id=$2 AND reaction='like' RETURNING discussion_id", [discussionId, req.user.id]);
  let liked = false;
  if (!existing.rowCount) {
    await pool.query("INSERT INTO discussion_reactions (discussion_id,user_id,reaction) VALUES ($1,$2,'like') ON CONFLICT DO NOTHING", [discussionId, req.user.id]);
    liked = true;
  }
  const count = await pool.query('SELECT COUNT(*)::INT AS count FROM discussion_reactions WHERE discussion_id=$1', [discussionId]);
  res.json({ liked, reactionCount: count.rows[0].count });
}

export async function deleteDiscussion(req, res) {
  const result = await pool.query(
    `DELETE FROM discussions WHERE id=$1 AND workspace_id=$2 AND author_id=$3 RETURNING id`,
    [req.params.discussionId, req.params.workspaceId, req.user.id]);
  if (!result.rowCount) throw httpError(404, 'Discussion not found or you cannot delete it');
  res.json({ ok: true });
}
