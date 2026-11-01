import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test, { after, before } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = randomBytes(48).toString('base64url');

const [{ createApp }, { pool }, { runMigrations }, { config }] = await Promise.all([
  import('../src/app.js'),
  import('../src/db/pool.js'),
  import('../src/db/migrate.js'),
  import('../src/config/env.js'),
]);

const runId = randomBytes(6).toString('hex');
const sessionTtl = 7 * 24 * 60 * 60 * 1000;
const users = [];
const workspaceIds = [];
let server;
let baseUrl;
let csrfCookie;
let csrfToken;
let owner;
let admin;
let member;
let invitee;
let outsider;
let workspace;
let outsiderWorkspace;
let acceptedAdminInvite;

function cookiePair(response, name) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const value = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  assert.ok(value, `Expected ${name} cookie`);
  return value.split(';', 1)[0];
}

async function request(path, { user, method = 'GET', body, sendCsrf = true } = {}) {
  const headers = { Accept: 'application/json' };
  const cookieValues = [csrfCookie, user?.sessionCookie].filter(Boolean);
  if (cookieValues.length) headers.Cookie = cookieValues.join('; ');
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (sendCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

async function createTestUser(label) {
  const email = `${label}-${runId}@example.test`;
  const result = await pool.query(
    `INSERT INTO users (email, display_name)
     VALUES ($1, $2)
     RETURNING id::TEXT AS id, email, display_name AS "displayName"`,
    [email, `Workspace ${label}`],
  );
  const user = result.rows[0];
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [
      createHash('sha256').update(token).digest('hex'),
      user.id,
      new Date(Date.now() + sessionTtl),
    ],
  );
  user.sessionCookie = `devflow_session=${token}`;
  users.push(user);
  return user;
}

function inviteToken(result) {
  const url = new URL(result.data.developmentInvitationUrl, 'http://devflow.test');
  return url.searchParams.get('token');
}

async function createWorkspaceAs(user, name) {
  const result = await request('/api/workspaces', {
    user,
    method: 'POST',
    body: { name },
  });
  assert.equal(result.response.status, 201, result.data?.error?.message);
  workspaceIds.push(result.data.workspace.id);
  return result.data.workspace;
}

async function inviteAs(user, workspaceId, email, role = 'member') {
  return request(`/api/workspaces/${workspaceId}/invitations`, {
    user,
    method: 'POST',
    body: { email, role },
  });
}

before(async () => {
  if (!config.database.name.endsWith('_test')) {
    throw new Error('Refusing to run workspace tests unless DEVFLOW_DB_NAME ends with _test.');
  }

  await runMigrations();
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const csrf = await request('/api/auth/csrf');
  assert.equal(csrf.response.status, 204);
  csrfCookie = cookiePair(csrf.response, 'devflow_csrf');
  csrfToken = csrfCookie.slice('devflow_csrf='.length);

  [owner, admin, member, invitee, outsider] = await Promise.all([
    createTestUser('owner'),
    createTestUser('admin'),
    createTestUser('member'),
    createTestUser('invitee'),
    createTestUser('outsider'),
  ]);
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  for (const id of workspaceIds) {
    await pool.query('DELETE FROM workspaces WHERE id = $1', [id]);
  }
  for (const user of users) {
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  }
  await pool.end();
});

test('workspace creation assigns one owner and lists only accessible workspaces', async () => {
  workspace = await createWorkspaceAs(owner, `Main Team ${runId}`);
  outsiderWorkspace = await createWorkspaceAs(outsider, `Outside Team ${runId}`);

  assert.equal(workspace.role, 'owner');
  assert.equal(workspace.memberCount, 1);
  assert.equal(workspace.settings.allowMemberInvites, true);

  const owners = await request('/api/workspaces', { user: owner });
  const outsiders = await request('/api/workspaces', { user: outsider });
  const emptyUser = await request('/api/workspaces', { user: member });
  assert.equal(owners.response.status, 200);
  assert.deepEqual(owners.data.workspaces.map((item) => item.id), [workspace.id]);
  assert.deepEqual(outsiders.data.workspaces.map((item) => item.id), [outsiderWorkspace.id]);
  assert.deepEqual(emptyUser.data.workspaces, []);

  const ownerCount = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM workspace_members
     WHERE workspace_id = $1 AND role = 'owner'`,
    [workspace.id],
  );
  assert.equal(ownerCount.rows[0].count, 1);
});

test('non-members cannot view or mutate another workspace', async () => {
  const get = await request(`/api/workspaces/${workspace.id}`, { user: outsider });
  const update = await request(`/api/workspaces/${workspace.id}`, {
    user: outsider,
    method: 'PATCH',
    body: { name: 'Unauthorized change' },
  });
  const remove = await request(`/api/workspaces/${workspace.id}`, {
    user: outsider,
    method: 'DELETE',
  });
  const members = await request(`/api/workspaces/${workspace.id}/members`, { user: outsider });

  for (const result of [get, update, remove, members]) {
    assert.equal(result.response.status, 404);
  }
});

test('development invitations store only token hashes and require the invited account email', async () => {
  const created = await inviteAs(owner, workspace.id, admin.email, 'admin');
  assert.equal(created.response.status, 201, created.data?.error?.message);
  assert.equal(created.data.delivery, 'development');
  assert.match(created.data.notice, /has not been sent/i);
  assert.equal(Object.hasOwn(created.data.invitation, 'token_hash'), false);

  acceptedAdminInvite = created.data.invitation;
  const token = inviteToken(created);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const stored = await pool.query(
    'SELECT token_hash FROM workspace_invitations WHERE id = $1',
    [acceptedAdminInvite.id],
  );
  assert.equal(stored.rows[0].token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(stored.rows[0].token_hash, token);

  const duplicate = await inviteAs(owner, workspace.id, admin.email, 'admin');
  assert.equal(duplicate.response.status, 409);

  const wrongAccount = await request('/api/invitations/accept', {
    user: outsider,
    method: 'POST',
    body: { token },
  });
  assert.equal(wrongAccount.response.status, 403);

  const accepted = await request('/api/invitations/accept', {
    user: admin,
    method: 'POST',
    body: { token },
  });
  assert.equal(accepted.response.status, 200, accepted.data?.error?.message);
  assert.equal(accepted.data.workspace.role, 'admin');

  const repeatAccept = await request('/api/invitations/accept', {
    user: admin,
    method: 'POST',
    body: { token },
  });
  assert.equal(repeatAccept.response.status, 410);

  const duplicateMemberInvite = await inviteAs(owner, workspace.id, admin.email, 'member');
  assert.equal(duplicateMemberInvite.response.status, 409);
});

test('invalid tokens are rejected and expired invitations cannot be accepted', async () => {
  const invalid = await request('/api/invitations/accept', {
    user: invitee,
    method: 'POST',
    body: { token: randomBytes(32).toString('base64url') },
  });
  assert.equal(invalid.response.status, 404);

  const created = await inviteAs(owner, workspace.id, invitee.email);
  assert.equal(created.response.status, 201, created.data?.error?.message);
  const token = inviteToken(created);
  // expires_at must stay later than created_at (workspace_invitations_expiry_after_creation).
  await pool.query(
    `UPDATE workspace_invitations
     SET created_at = NOW() - INTERVAL '2 seconds', expires_at = NOW() - INTERVAL '1 second'
     WHERE id = $1`,
    [created.data.invitation.id],
  );

  const expired = await request('/api/invitations/accept', {
    user: invitee,
    method: 'POST',
    body: { token },
  });
  assert.equal(expired.response.status, 410);
});

test('owners can grant roles, while admin and member changes stay within their permissions', async () => {
  const memberInvite = await inviteAs(owner, workspace.id, member.email);
  assert.equal(memberInvite.response.status, 201, memberInvite.data?.error?.message);
  const memberToken = inviteToken(memberInvite);
  const accepted = await request('/api/invitations/accept', {
    user: member,
    method: 'POST',
    body: { token: memberToken },
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.data.workspace.role, 'member');

  const adminRole = await request(`/api/workspaces/${workspace.id}/members/${member.id}`, {
    user: admin,
    method: 'PATCH',
    body: { role: 'admin' },
  });
  const memberDelete = await request(`/api/workspaces/${workspace.id}/members/${admin.id}`, {
    user: member,
    method: 'DELETE',
  });
  const adminDeleteOwner = await request(`/api/workspaces/${workspace.id}/members/${owner.id}`, {
    user: admin,
    method: 'DELETE',
  });
  const adminDeleteWorkspace = await request(`/api/workspaces/${workspace.id}`, {
    user: admin,
    method: 'DELETE',
  });

  assert.equal(adminRole.response.status, 403);
  assert.equal(memberDelete.response.status, 403);
  assert.equal(adminDeleteOwner.response.status, 409);
  assert.equal(adminDeleteWorkspace.response.status, 403);

  const changedRole = await request(`/api/workspaces/${workspace.id}/members/${member.id}`, {
    user: owner,
    method: 'PATCH',
    body: { role: 'admin' },
  });
  assert.equal(changedRole.response.status, 200);
  assert.equal(changedRole.data.member.role, 'admin');

  const adminInviteMember = await inviteAs(admin, workspace.id, `${runId}-new-member@example.test`);
  assert.equal(adminInviteMember.response.status, 201, adminInviteMember.data?.error?.message);
  const adminInviteAdmin = await inviteAs(admin, workspace.id, `${runId}-new-admin@example.test`, 'admin');
  assert.equal(adminInviteAdmin.response.status, 403);

  const adminSettings = await request(`/api/workspaces/${workspace.id}`, {
    user: admin,
    method: 'PATCH',
    body: { settings: { allowMemberInvites: false } },
  });
  assert.equal(adminSettings.response.status, 403);

  const disabledSettings = await request(`/api/workspaces/${workspace.id}`, {
    user: owner,
    method: 'PATCH',
    body: { settings: { allowMemberInvites: false } },
  });
  assert.equal(disabledSettings.response.status, 200);
  // allowMemberInvites only governs the Member role; admins can always invite members.
  const adminInviteWhileDisabled = await inviteAs(admin, workspace.id, `${runId}-disabled@example.test`);
  assert.equal(adminInviteWhileDisabled.response.status, 201, adminInviteWhileDisabled.data?.error?.message);
  const enabledSettings = await request(`/api/workspaces/${workspace.id}`, {
    user: owner,
    method: 'PATCH',
    body: { settings: { allowMemberInvites: true } },
  });
  assert.equal(enabledSettings.response.status, 200);

  const workspaceUpdate = await request(`/api/workspaces/${workspace.id}`, {
    user: owner,
    method: 'PATCH',
    body: { name: `Renamed Team ${runId}`, description: 'Workspace description' },
  });
  assert.equal(workspaceUpdate.response.status, 200);
  assert.equal(workspaceUpdate.data.workspace.name, `Renamed Team ${runId}`);
  assert.equal(workspaceUpdate.data.workspace.description, 'Workspace description');

  const removed = await request(`/api/workspaces/${workspace.id}/members/${member.id}`, {
    user: owner,
    method: 'DELETE',
  });
  assert.equal(removed.response.status, 200);
  const lostAccess = await request(`/api/workspaces/${workspace.id}`, { user: member });
  assert.equal(lostAccess.response.status, 404);
});

test('admins can invite and remove members but cannot remove admins; owners cannot be removed', async () => {
  const added = await inviteAs(owner, workspace.id, member.email);
  assert.equal(added.response.status, 201);
  const token = inviteToken(added);
  const accepted = await request('/api/invitations/accept', {
    user: member,
    method: 'POST',
    body: { token },
  });
  assert.equal(accepted.response.status, 200);

  const secondAdmin = await createTestUser('second-admin');
  const secondAdminInvite = await inviteAs(owner, workspace.id, secondAdmin.email, 'admin');
  assert.equal(secondAdminInvite.response.status, 201, secondAdminInvite.data?.error?.message);
  const secondAdminAccepted = await request('/api/invitations/accept', {
    user: secondAdmin,
    method: 'POST',
    body: { token: inviteToken(secondAdminInvite) },
  });
  assert.equal(secondAdminAccepted.response.status, 200);

  const members = await request(`/api/workspaces/${workspace.id}/members`, { user: admin });
  assert.equal(members.response.status, 200);
  assert.equal(members.data.members.length, 4);

  const adminRemovesOwner = await request(`/api/workspaces/${workspace.id}/members/${owner.id}`, {
    user: admin,
    method: 'DELETE',
  });
  const adminRemovesAdmin = await request(`/api/workspaces/${workspace.id}/members/${secondAdmin.id}`, {
    user: admin,
    method: 'DELETE',
  });
  const adminRemovesMember = await request(`/api/workspaces/${workspace.id}/members/${member.id}`, {
    user: admin,
    method: 'DELETE',
  });

  assert.equal(adminRemovesOwner.response.status, 409);
  assert.equal(adminRemovesAdmin.response.status, 403);
  assert.equal(adminRemovesMember.response.status, 200);
});

test('admins can revoke only member invitations and revoked links cannot be accepted', async () => {
  const ownerInvite = await inviteAs(owner, workspace.id, `${runId}-owner-admin@example.test`, 'admin');
  const ownerInviteRevoke = await request(
    `/api/workspaces/${workspace.id}/invitations/${ownerInvite.data.invitation.id}`,
    { user: admin, method: 'DELETE' },
  );
  assert.equal(ownerInviteRevoke.response.status, 403);

  const memberInvite = await inviteAs(admin, workspace.id, `${runId}-revoke@example.test`);
  assert.equal(memberInvite.response.status, 201, memberInvite.data?.error?.message);
  const revoked = await request(
    `/api/workspaces/${workspace.id}/invitations/${memberInvite.data.invitation.id}`,
    { user: admin, method: 'DELETE' },
  );
  assert.equal(revoked.response.status, 200);

  const revokedToken = inviteToken(memberInvite);
  const revokedEmailUser = await createTestUser('revoked');
  const updateEmail = await pool.query(
    'UPDATE users SET email = $1 WHERE id = $2 RETURNING email',
    [`${runId}-revoke@example.test`, revokedEmailUser.id],
  );
  revokedEmailUser.email = updateEmail.rows[0].email;
  const acceptance = await request('/api/invitations/accept', {
    user: revokedEmailUser,
    method: 'POST',
    body: { token: revokedToken },
  });
  assert.equal(acceptance.response.status, 410);
});

test('workspace owners can delete their workspace, and deleted workspaces are inaccessible', async () => {
  const forbidden = await request(`/api/workspaces/${outsiderWorkspace.id}`, {
    user: owner,
    method: 'DELETE',
  });
  assert.equal(forbidden.response.status, 404);

  const deleted = await request(`/api/workspaces/${workspace.id}`, {
    user: owner,
    method: 'DELETE',
  });
  assert.equal(deleted.response.status, 200);
  const inaccessible = await request(`/api/workspaces/${workspace.id}`, { user: owner });
  assert.equal(inaccessible.response.status, 404);

  const outsiderWorkspaceCheck = await request(`/api/workspaces/${outsiderWorkspace.id}`, { user: outsider });
  assert.equal(outsiderWorkspaceCheck.response.status, 200);
});
