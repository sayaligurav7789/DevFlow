import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config/env.js';
import { httpError } from '../utils/httpError.js';
import {
  isValidBigintId,
  lockWorkspaceAccess,
  withTransaction,
} from '../services/workspaceAccess.service.js';
import { notifyInvitation, resolveInvitationNotifications } from '../services/notifications.service.js';
import {
  sendInvitationEmail,
  isEmailConfigured,
} from '../email.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bodyObject(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function digestToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function isInvitationManager(role) {
  return role === 'owner' || role === 'admin';
}

// Who may create an invitation, and for which role:
//   owner  -> admin or member invitations, always
//   admin  -> member invitations, always
//   member -> member invitations, only while the owner has enabled allowMemberInvites
// Returns an error message, or null when the invitation is allowed.
function invitationPermissionError(role, settings, invitedRole) {
  if (role === 'owner') return null;
  if (role !== 'admin' && role !== 'member') return 'You do not have permission to invite teammates';
  if (invitedRole !== 'member') return 'Only the workspace owner can invite admins';
  if (role === 'member' && settings?.allowMemberInvites !== true) {
    return 'The workspace owner has not allowed members to invite teammates';
  }
  return null;
}

export async function listInvitations(req, res, next) {
  if (!isInvitationManager(req.workspace.role)) {
    return res.status(403).json({ error: { message: 'Only workspace owners and admins can view invitations' } });
  }

  try {
    const result = await pool.query(
      `SELECT i.id::TEXT AS id, i.email, i.role,
              i.created_at AS "invitedAt", i.expires_at AS "expiresAt",
              CASE
                WHEN i.accepted_at IS NOT NULL THEN 'accepted'
                WHEN i.expires_at <= NOW() THEN 'expired'
                WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                ELSE 'pending'
              END AS status,
              u.display_name AS "invitedBy"
       FROM workspace_invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.workspace_id = $1
       ORDER BY i.created_at DESC, i.id DESC`,
      [req.params.workspaceId],
    );
    return res.json({ invitations: result.rows });
  } catch (error) {
    return next(error);
  }
}


export async function createInvitation(req, res, next) {
  const { email: rawEmail, role = 'member' } = bodyObject(req);
  const email = normalizedEmail(rawEmail);

  if (!email) {
    return res.status(400).json({
      error: { message: 'Enter a valid email address' },
    });
  }

  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({
      error: { message: 'Invitation role must be admin or member' },
    });
  }

  const permissionError = invitationPermissionError(
    req.workspace.role,
    req.workspace.settings,
    role,
  );

  if (permissionError) {
    return res.status(403).json({
      error: { message: permissionError },
    });
  }

  const emailConfigured = isEmailConfigured();

  if (config.isProduction && !emailConfigured) {
    return res.status(503).json({
      error: {
        message: 'Email delivery is not configured. No invitation was created or sent.',
      },
    });
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = digestToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const invitationPath =
    `/invitations/accept?token=${encodeURIComponent(token)}`;

  try {
    const invitation = await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(
        client,
        req.params.workspaceId,
        req.user.id,
      );

      if (!access) {
        throw httpError(404, 'Workspace not found');
      }

      const lockedPermissionError = invitationPermissionError(
        access.role,
        access.settings,
        role,
      );

      if (lockedPermissionError) {
        throw httpError(403, lockedPermissionError);
      }

      const existingMember = await client.query(
        `SELECT 1
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1 AND u.email = $2`,
        [req.params.workspaceId, email],
      );

      if (existingMember.rowCount > 0) {
        throw httpError(409, 'This person is already a workspace member');
      }

      await client.query(
        `UPDATE workspace_invitations
         SET revoked_at = NOW()
         WHERE workspace_id = $1 AND email = $2
           AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at <= NOW()`,
        [req.params.workspaceId, email],
      );

      const activeInvitation = await client.query(
        `SELECT 1
         FROM workspace_invitations
         WHERE workspace_id = $1 AND email = $2
           AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at > NOW()`,
        [req.params.workspaceId, email],
      );

      if (activeInvitation.rowCount > 0) {
        throw httpError(
          409,
          'An active invitation already exists for this email',
        );
      }

      const result = await client.query(
        `INSERT INTO workspace_invitations
           (workspace_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id::TEXT AS id, email, role,
                   created_at AS "invitedAt",
                   expires_at AS "expiresAt"`,
        [
          req.params.workspaceId,
          email,
          role,
          tokenHash,
          req.user.id,
          expiresAt,
        ],
      );

      await notifyInvitation(client, {
        invitation: result.rows[0],
        workspace: access,
        inviter: req.user,
      });

      return result.rows[0];
    });

    // Preserve the existing development-only invitation link
    // when SMTP credentials have not been configured.
    if (!emailConfigured) {
      return res.status(201).json({
        invitation,
        delivery: 'development',
        developmentInvitationUrl: invitationPath,
        notice:
          'Email delivery is not configured. This development-only invitation link has not been sent.',
      });
    }

    // Look up the workspace and inviter names for the email.
    const details = await pool.query(
      `SELECT
         w.name AS "workspaceName",
         u.display_name AS "inviterName"
       FROM workspaces w
       LEFT JOIN users u ON u.id = $2
       WHERE w.id = $1`,
      [req.params.workspaceId, req.user.id],
    );

    if (details.rowCount === 0) {
      throw new Error('Could not find workspace details for the invitation email.');
    }

    const { workspaceName, inviterName } = details.rows[0];
    const invitationUrl = new URL(
      invitationPath,
      config.clientOrigin,
    ).toString();

    try {
      await sendInvitationEmail({
        to: email,
        workspaceName,
        inviterName,
        role,
        invitationUrl,
      });

      return res.status(201).json({
        invitation,
        delivery: 'email',
        notice: `Invitation email sent to ${email}.`,
      });
    } catch (emailError) {
      // Keep the created invitation valid so it can be shared manually.
      console.error(
        'Invitation email delivery failed:',
        emailError.message,
      );

      return res.status(201).json({
        invitation,
        delivery: 'failed',
        developmentInvitationUrl: invitationPath,
        notice:
          'The invitation was created, but the email could not be sent. Share the invitation link manually.',
      });
    }
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: {
          message: 'An active invitation already exists for this email',
        },
      });
    }

    return next(error);
  }
}

export async function revokeInvitation(req, res, next) {
  const { invitationId } = req.params;
  if (!isValidBigintId(invitationId)) return res.status(404).json({ error: { message: 'Invitation not found' } });
  if (!isInvitationManager(req.workspace.role)) {
    return res.status(403).json({ error: { message: 'Only workspace owners and admins can revoke invitations' } });
  }

  try {
    await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      if (!isInvitationManager(access.role)) {
        throw httpError(403, 'Only workspace owners and admins can revoke invitations');
      }

      const selected = await client.query(
        `SELECT id, role, accepted_at, revoked_at
         FROM workspace_invitations
         WHERE id = $1 AND workspace_id = $2
         FOR UPDATE`,
        [invitationId, req.params.workspaceId],
      );
      if (selected.rowCount === 0) throw httpError(404, 'Invitation not found');
      const invitation = selected.rows[0];
      if (invitation.accepted_at || invitation.revoked_at) {
        throw httpError(409, 'This invitation is no longer pending');
      }
      if (access.role === 'admin' && invitation.role !== 'member') {
        throw httpError(403, 'Admins can only revoke member invitations');
      }

      await client.query(
        'UPDATE workspace_invitations SET revoked_at = NOW() WHERE id = $1',
        [invitationId],
      );
      await resolveInvitationNotifications(client, invitationId);
    });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

export async function acceptInvitation(req, res, next) {
  const { token } = bodyObject(req);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return res.status(404).json({ error: { message: 'Invitation not found or no longer available' } });
  }
  const tokenHash = digestToken(token);

  try {
    const found = await pool.query(
      'SELECT workspace_id::TEXT AS "workspaceId" FROM workspace_invitations WHERE token_hash = $1',
      [tokenHash],
    );
    if (found.rowCount === 0) {
      return res.status(404).json({ error: { message: 'Invitation not found or no longer available' } });
    }

    const result = await withTransaction(async (client) => {
      const workspaceResult = await client.query(
        `SELECT id::TEXT AS id, slug, name, description, settings
         FROM workspaces WHERE id = $1 FOR UPDATE`,
        [found.rows[0].workspaceId],
      );
      if (workspaceResult.rowCount === 0) throw httpError(404, 'Invitation not found or no longer available');

      const invitationResult = await client.query(
        `SELECT id, workspace_id::TEXT AS "workspaceId", email, role,
                expires_at AS "expiresAt", accepted_at AS "acceptedAt", revoked_at AS "revokedAt"
         FROM workspace_invitations
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash],
      );
      if (invitationResult.rowCount === 0) throw httpError(404, 'Invitation not found or no longer available');
      const invitation = invitationResult.rows[0];
      if (invitation.acceptedAt || invitation.revokedAt) {
        throw httpError(410, 'This invitation is no longer available');
      }
      if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
        throw httpError(410, 'This invitation has expired');
      }

      const userResult = await client.query(
        'SELECT email FROM users WHERE id = $1 FOR SHARE',
        [req.user.id],
      );
      if (userResult.rowCount === 0) throw httpError(401, 'Authentication required');
      if (userResult.rows[0].email !== invitation.email) {
        throw httpError(403, 'Sign in with the email address that received this invitation');
      }

      const existingMember = await client.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [invitation.workspaceId, req.user.id],
      );
      if (existingMember.rowCount > 0) throw httpError(409, 'You are already a member of this workspace');

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [invitation.workspaceId, req.user.id, invitation.role],
      );
      await client.query(
        `UPDATE workspace_invitations
         SET accepted_at = NOW(), accepted_by = $1
         WHERE id = $2`,
        [req.user.id, invitation.id],
      );
      await resolveInvitationNotifications(client, invitation.id);

      const memberCount = await client.query(
        'SELECT COUNT(*)::INTEGER AS count FROM workspace_members WHERE workspace_id = $1',
        [invitation.workspaceId],
      );

      return {
        ...workspaceResult.rows[0],
        role: invitation.role,
        memberCount: memberCount.rows[0].count,
      };
    });
    return res.status(200).json({ workspace: result });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'workspace_members_pkey') {
      return res.status(409).json({ error: { message: 'You are already a member of this workspace' } });
    }
    return next(error);
  }
}
