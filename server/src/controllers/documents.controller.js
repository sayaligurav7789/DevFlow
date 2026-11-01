import { pool } from '../db/pool.js';
import { httpError } from '../utils/httpError.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg',
  'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const safeName = (value) => String(value ?? '').replace(/[\\/\0-\x1f]/g, '_').trim().slice(0, 255);

export async function listDocuments(req, res) {
  const { workspaceId } = req.params;
  const projectId = req.query.projectId || null;
  if (projectId) {
    const project = await pool.query('SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$2', [projectId, workspaceId]);
    if (!project.rowCount) throw httpError(404, 'Project not found');
  }
  const result = await pool.query(
    `SELECT d.id::TEXT AS id, d.file_name AS "fileName", d.mime_type AS "mimeType",
            d.file_size AS "fileSize", d.project_id::TEXT AS "projectId",
            p.name AS "projectName", d.created_at AS "createdAt",
            u.display_name AS "uploadedBy"
     FROM workspace_documents d LEFT JOIN projects p ON p.id=d.project_id
     LEFT JOIN users u ON u.id=d.uploaded_by
     WHERE d.workspace_id=$1 AND ($2::BIGINT IS NULL OR d.project_id=$2)
     ORDER BY d.created_at DESC LIMIT 200`, [workspaceId, projectId]);
  res.json({ documents: result.rows });
}

export async function uploadDocument(req, res) {
  const { workspaceId } = req.params;
  const fileName = safeName(req.body?.fileName);
  const mimeType = String(req.body?.mimeType || 'application/octet-stream').toLowerCase();
  const encoded = req.body?.data;
  const projectId = req.body?.projectId || null;
  if (!fileName || !encoded || typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw httpError(400, 'Choose a valid file to upload');
  if (!ALLOWED_TYPES.has(mimeType)) throw httpError(415, 'This file type is not supported');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw httpError(413, 'Files must be 5 MB or smaller');
  if (projectId) {
    const project = await pool.query('SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$2', [projectId, workspaceId]);
    if (!project.rowCount) throw httpError(404, 'Project not found');
  }
  const result = await pool.query(
    `INSERT INTO workspace_documents (workspace_id, project_id, uploaded_by, file_name, mime_type, file_size, file_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id::TEXT AS id, file_name AS "fileName", mime_type AS "mimeType", file_size AS "fileSize", project_id::TEXT AS "projectId", created_at AS "createdAt"`,
    [workspaceId, projectId, req.user.id, fileName, mimeType, buffer.length, buffer]);
  res.status(201).json({ document: result.rows[0] });
}

export async function downloadDocument(req, res) {
  const result = await pool.query(
    `SELECT file_name, mime_type, file_data FROM workspace_documents WHERE id=$1 AND workspace_id=$2`,
    [req.params.documentId, req.params.workspaceId]);
  if (!result.rowCount) throw httpError(404, 'Document not found');
  const file = result.rows[0];
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Length', file.file_data.length);
  res.setHeader('Content-Disposition', `attachment; filename="${file.file_name.replace(/["\\\r\n]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.file_data);
}

export async function deleteDocument(req, res) {
  const result = await pool.query(
    `DELETE FROM workspace_documents WHERE id=$1 AND workspace_id=$2
     AND (uploaded_by=$3 OR EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=$2 AND user_id=$3 AND role IN ('owner','admin')))
     RETURNING id`, [req.params.documentId, req.params.workspaceId, req.user.id]);
  if (!result.rowCount) throw httpError(404, 'Document not found or you do not have permission to delete it');
  res.json({ ok: true });
}
