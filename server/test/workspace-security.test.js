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
let outsider;
let workspace; // owned by `owner`, with `admin` and `member` joined
let outsiderWorkspace; // owned by `outsider`

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
    [email, `Security ${label}`],
  );
  const user = result.rows[0];
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [createHash('sha256').update(token).digest('hex'), user.id, new Date(Date.now() + sessionTtl)],
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
  const result = await request('/api/workspaces', { user, method: 'POST', body: { name } });
  assert.equal(result.response.status, 201, result.data?.error?.message);
  workspaceIds.push(result.data.workspace.id);
  return result.data.workspace;
}

function inviteAs(user, workspaceId, email, role = 'member') {
  return request(`/api/workspaces/${workspaceId}/invitations`, {
    user,
    method: 'POST',
    body: { email, role },
  });
}

function acceptAs(user, token) {
  return request('/api/invitations/accept', { user, method: 'POST', body: { token } });
}

async function joinAs(user, role = 'member', targetWorkspace = workspace, inviter = owner) {
  const invited = await inviteAs(inviter, targetWorkspace.id, user.email, role);
  assert.equal(invited.response.status, 201, invited.data?.error?.message);
  const accepted = await acceptAs(user, inviteToken(invited));
  assert.equal(accepted.response.status, 200, accepted.data?.error?.message);
  return accepted.data.workspace;
}

// expires_at must stay later than created_at (workspace_invitations_expiry_after_creation).
async function expireInvitation(invitationId) {
  await pool.query(
    `UPDATE workspace_invitations
     SET created_at = NOW() - INTERVAL '2 seconds', expires_at = NOW() - INTERVAL '1 second'
     WHERE id = $1`,
    [invitationId],
  );
}

async function invitationRow(invitationId) {
  const result = await pool.query(
    `SELECT accepted_at, revoked_at FROM workspace_invitations WHERE id = $1`,
    [invitationId],
  );
  return result.rows[0];
}

async function membershipRole(workspaceId, userId) {
  const result = await pool.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  return result.rows[0]?.role ?? null;
}

async function setMemberInvites(allowed) {
  const result = await request(`/api/workspaces/${workspace.id}`, {
    user: owner,
    method: 'PATCH',
    body: { settings: { allowMemberInvites: allowed } },
  });
  assert.equal(result.response.status, 200, result.data?.error?.message);
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

  [owner, admin, member, outsider] = await Promise.all([
    createTestUser('owner'),
    createTestUser('admin'),
    createTestUser('member'),
    createTestUser('outsider'),
  ]);

  workspace = await createWorkspaceAs(owner, `Security Team ${runId}`);
  outsiderWorkspace = await createWorkspaceAs(outsider, `Outsider Team ${runId}`);
  await joinAs(admin, 'admin');
  await joinAs(member, 'member');
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  // workspaces.created_by is ON DELETE RESTRICT, so delete workspaces before users.
  for (const id of workspaceIds) {
    await pool.query('DELETE FROM workspaces WHERE id = $1', [id]);
  }
  for (const user of users) {
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  }
  await pool.end();
});

test('unauthenticated requests are rejected on every workspace and invitation endpoint', async () => {
  const w = workspace.id;
  const calls = [
    ['GET', '/api/workspaces'],
    ['POST', '/api/workspaces', { name: 'No session' }],
    ['GET', `/api/workspaces/${w}`],
    ['PATCH', `/api/workspaces/${w}`, { name: 'No session' }],
    ['DELETE', `/api/workspaces/${w}`],
    ['GET', `/api/workspaces/${w}/members`],
    ['PATCH', `/api/workspaces/${w}/members/${member.id}`, { role: 'admin' }],
    ['DELETE', `/api/workspaces/${w}/members/${member.id}`],
    ['GET', `/api/workspaces/${w}/invitations`],
    ['POST', `/api/workspaces/${w}/invitations`, { email: 'nobody@example.test' }],
    ['DELETE', `/api/workspaces/${w}/invitations/1`],
    ['POST', '/api/invitations/accept', { token: randomBytes(32).toString('base64url') }],
  ];

  for (const [method, path, body] of calls) {
    const result = await request(path, { method, body });
    assert.equal(result.response.status, 401, `${method} ${path}`);
  }
  assert.equal(await membershipRole(w, member.id), 'member');
});

test('state-changing requests without a CSRF token are rejected even with a valid session', async () => {
  const result = await request('/api/workspaces', {
    user: owner,
    method: 'POST',
    body: { name: `No CSRF ${runId}` },
    sendCsrf: false,
  });
  assert.equal(result.response.status, 403);

  const inviteWithoutCsrf = await request(`/api/workspaces/${workspace.id}/invitations`, {
    user: owner,
    method: 'POST',
    body: { email: `${runId}-nocsrf@example.test` },
    sendCsrf: false,
  });
  assert.equal(inviteWithoutCsrf.response.status, 403);
});

test('malformed workspace, member, and invitation ids return 404 instead of reaching the database', async () => {
  for (const id of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
    const result = await request(`/api/workspaces/${id}`, { user: owner });
    assert.equal(result.response.status, 404, `workspace id ${id}`);
  }

  const badMember = await request(`/api/workspaces/${workspace.id}/members/abc`, {
    user: owner,
    method: 'DELETE',
  });
  assert.equal(badMember.response.status, 404);

  const badInvitation = await request(`/api/workspaces/${workspace.id}/invitations/abc`, {
    user: owner,
    method: 'DELETE',
  });
  assert.equal(badInvitation.response.status, 404);
});

test('cross-workspace access: another workspace\'s owner cannot read or change this workspace', async () => {
  const pending = await inviteAs(owner, workspace.id, `${runId}-cross@example.test`);
  assert.equal(pending.response.status, 201, pending.data?.error?.message);
  const pendingId = pending.data.invitation.id;
  const w = workspace.id;

  const attempts = [
    ['GET', `/api/workspaces/${w}`],
    ['PATCH', `/api/workspaces/${w}`, { name: 'Hijacked' }],
    ['DELETE', `/api/workspaces/${w}`],
    ['GET', `/api/workspaces/${w}/members`],
    ['PATCH', `/api/workspaces/${w}/members/${member.id}`, { role: 'admin' }],
    ['DELETE', `/api/workspaces/${w}/members/${member.id}`],
    ['GET', `/api/workspaces/${w}/invitations`],
    ['POST', `/api/workspaces/${w}/invitations`, { email: `${runId}-intruder@example.test` }],
    ['DELETE', `/api/workspaces/${w}/invitations/${pendingId}`],
  ];
  for (const [method, path, body] of attempts) {
    const result = await request(path, { user: outsider, method, body });
    assert.equal(result.response.status, 404, `${method} ${path}`);
  }

  // Using the outsider's own workspace in the URL must not reach objects that belong to another workspace.
  const o = outsiderWorkspace.id;
  const viaOwnWorkspace = [
    ['DELETE', `/api/workspaces/${o}/invitations/${pendingId}`],
    ['DELETE', `/api/workspaces/${o}/members/${admin.id}`],
    ['PATCH', `/api/workspaces/${o}/members/${admin.id}`, { role: 'member' }],
  ];
  for (const [method, path, body] of viaOwnWorkspace) {
    const result = await request(path, { user: outsider, method, body });
    assert.equal(result.response.status, 404, `${method} ${path}`);
  }

  const after = await invitationRow(pendingId);
  assert.equal(after.revoked_at, null);
  assert.equal(after.accepted_at, null);
  assert.equal(await membershipRole(w, admin.id), 'admin');
  assert.equal(await membershipRole(w, member.id), 'member');
  const stillNamed = await pool.query('SELECT name FROM workspaces WHERE id = $1', [w]);
  assert.equal(stillNamed.rows[0].name, `Security Team ${runId}`);
});

test('roles are per workspace: owning one workspace grants nothing in another', async () => {
  const dual = await createTestUser('dual');
  await createWorkspaceAs(dual, `Dual Home ${runId}`);
  await joinAs(dual, 'member');
  const w = workspace.id;

  const attempts = [
    ['PATCH', `/api/workspaces/${w}`, { name: 'Escalated' }],
    ['DELETE', `/api/workspaces/${w}`],
    ['PATCH', `/api/workspaces/${w}/members/${member.id}`, { role: 'admin' }],
    ['DELETE', `/api/workspaces/${w}/members/${admin.id}`],
    ['GET', `/api/workspaces/${w}/invitations`],
    ['POST', `/api/workspaces/${w}/invitations`, { email: `${runId}-esc@example.test`, role: 'admin' }],
  ];
  for (const [method, path, body] of attempts) {
    const result = await request(path, { user: dual, method, body });
    assert.equal(result.response.status, 403, `${method} ${path}`);
  }
  assert.equal(await membershipRole(w, admin.id), 'admin');
  assert.equal(await membershipRole(w, member.id), 'member');
});

test('invalid invitation tokens are rejected without side effects', async () => {
  const invitee = await createTestUser('badcred');
  const created = await inviteAs(owner, workspace.id, invitee.email);
  assert.equal(created.response.status, 201, created.data?.error?.message);
  const realToken = inviteToken(created);
  const flipped = `${realToken.slice(0, -1)}${realToken.endsWith('A') ? 'B' : 'A'}`;

  const badTokens = [
    undefined,
    null,
    '',
    123,
    ['a'],
    { token: 'x' },
    'short',
    'A'.repeat(42),
    'A'.repeat(44),
    `${'A'.repeat(42)}!`,
    randomBytes(32).toString('base64url'),
    flipped,
  ];
  for (const token of badTokens) {
    const result = await request('/api/invitations/accept', {
      user: invitee,
      method: 'POST',
      body: token === undefined ? {} : { token },
    });
    assert.equal(result.response.status, 404, `token ${JSON.stringify(token)}`);
  }

  assert.equal(await membershipRole(workspace.id, invitee.id), null);
  const untouched = await invitationRow(created.data.invitation.id);
  assert.equal(untouched.accepted_at, null);

  // Positive control: the real token still works once, and the response carries a real member count.
  const accepted = await acceptAs(invitee, realToken);
  assert.equal(accepted.response.status, 200, accepted.data?.error?.message);
  const counted = await pool.query(
    'SELECT COUNT(*)::INTEGER AS count FROM workspace_members WHERE workspace_id = $1',
    [workspace.id],
  );
  assert.equal(accepted.data.workspace.memberCount, counted.rows[0].count);
});

test('expired invitations are listed as expired, cannot be accepted, and can be re-issued', async () => {
  const invitee = await createTestUser('expired');
  const created = await inviteAs(owner, workspace.id, invitee.email);
  assert.equal(created.response.status, 201, created.data?.error?.message);
  const oldToken = inviteToken(created);
  const oldId = created.data.invitation.id;
  await expireInvitation(oldId);

  const listed = await request(`/api/workspaces/${workspace.id}/invitations`, { user: owner });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.invitations.find((item) => item.id === oldId).status, 'expired');

  const expiredAccept = await acceptAs(invitee, oldToken);
  assert.equal(expiredAccept.response.status, 410);
  assert.equal(await membershipRole(workspace.id, invitee.id), null);
  assert.equal((await invitationRow(oldId)).accepted_at, null);

  // An expired invitation must not block a fresh one for the same email.
  const reissued = await inviteAs(admin, workspace.id, invitee.email);
  assert.equal(reissued.response.status, 201, reissued.data?.error?.message);
  const newToken = inviteToken(reissued);
  assert.notEqual(newToken, oldToken);

  const oldAgain = await acceptAs(invitee, oldToken);
  assert.equal(oldAgain.response.status, 410);
  const relisted = await request(`/api/workspaces/${workspace.id}/invitations`, { user: owner });
  assert.equal(relisted.data.invitations.find((item) => item.id === reissued.data.invitation.id).status, 'pending');

  const fresh = await acceptAs(invitee, newToken);
  assert.equal(fresh.response.status, 200, fresh.data?.error?.message);
  assert.equal(await membershipRole(workspace.id, invitee.id), 'member');
});

test('duplicate membership is prevented by the API and by the database', async () => {
  const w = workspace.id;

  // Inviting someone who is already a member.
  const existing = await inviteAs(owner, w, member.email);
  assert.equal(existing.response.status, 409);

  // Accepting an invitation after becoming a member by another route rolls back cleanly.
  const raced = await createTestUser('already');
  const created = await inviteAs(owner, w, raced.email);
  assert.equal(created.response.status, 201, created.data?.error?.message);
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
    [w, raced.id],
  );
  const accepted = await acceptAs(raced, inviteToken(created));
  assert.equal(accepted.response.status, 409);
  assert.equal((await invitationRow(created.data.invitation.id)).accepted_at, null);
  const rows = await pool.query(
    'SELECT COUNT(*)::INTEGER AS count FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [w, raced.id],
  );
  assert.equal(rows.rows[0].count, 1);

  // Database constraints back the API checks.
  await assert.rejects(
    pool.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, [w, member.id]),
    (error) => error.code === '23505' && error.constraint === 'workspace_members_pkey',
  );
  const loner = await createTestUser('loner');
  await assert.rejects(
    pool.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [w, loner.id]),
    (error) => error.code === '23505' && error.constraint === 'workspace_members_single_owner_idx',
  );
  const pendingTwice = await inviteAs(owner, w, `${runId}-twice@example.test`);
  assert.equal(pendingTwice.response.status, 201);
  const secondPending = await inviteAs(admin, w, `${runId}-twice@example.test`);
  assert.equal(secondPending.response.status, 409);
});

test('two simultaneous acceptances of one invitation create exactly one membership', async () => {
  const racer = await createTestUser('racer');
  const created = await inviteAs(owner, workspace.id, racer.email);
  assert.equal(created.response.status, 201, created.data?.error?.message);
  const token = inviteToken(created);

  const results = await Promise.all([acceptAs(racer, token), acceptAs(racer, token)]);
  const statuses = results.map((result) => result.response.status).sort();
  assert.deepEqual(statuses, [200, 410]);

  const rows = await pool.query(
    'SELECT COUNT(*)::INTEGER AS count FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspace.id, racer.id],
  );
  assert.equal(rows.rows[0].count, 1);
});

test('members can invite only while allowMemberInvites is on, and only as members', async () => {
  await setMemberInvites(true);
  const allowed = await inviteAs(member, workspace.id, `${runId}-by-member@example.test`);
  assert.equal(allowed.response.status, 201, allowed.data?.error?.message);

  const asAdmin = await inviteAs(member, workspace.id, `${runId}-member-admin@example.test`, 'admin');
  assert.equal(asAdmin.response.status, 403);

  // Members never get to see or revoke invitations.
  const listed = await request(`/api/workspaces/${workspace.id}/invitations`, { user: member });
  assert.equal(listed.response.status, 403);
  const revoked = await request(
    `/api/workspaces/${workspace.id}/invitations/${allowed.data.invitation.id}`,
    { user: member, method: 'DELETE' },
  );
  assert.equal(revoked.response.status, 403);

  await setMemberInvites(false);
  try {
    const blocked = await inviteAs(member, workspace.id, `${runId}-blocked@example.test`);
    assert.equal(blocked.response.status, 403);
    const adminStillInvites = await inviteAs(admin, workspace.id, `${runId}-admin-ok@example.test`);
    assert.equal(adminStillInvites.response.status, 201, adminStillInvites.data?.error?.message);
  } finally {
    await setMemberInvites(true);
  }
});

test('members cannot manage the workspace, roles, or other members', async () => {
  const w = workspace.id;
  const attempts = [
    ['PATCH', `/api/workspaces/${w}`, { name: 'Member rename' }],
    ['DELETE', `/api/workspaces/${w}`],
    ['PATCH', `/api/workspaces/${w}/members/${admin.id}`, { role: 'member' }],
    ['DELETE', `/api/workspaces/${w}/members/${admin.id}`],
  ];
  for (const [method, path, body] of attempts) {
    const result = await request(path, { user: member, method, body });
    assert.equal(result.response.status, 403, `${method} ${path}`);
  }
  assert.equal(await membershipRole(w, admin.id), 'admin');
});

test('members can leave, but the owner cannot be removed or leave', async () => {
  const leaver = await createTestUser('leaver');
  await joinAs(leaver, 'member');

  const left = await request(`/api/workspaces/${workspace.id}/members/${leaver.id}`, {
    user: leaver,
    method: 'DELETE',
  });
  assert.equal(left.response.status, 200);
  const lostAccess = await request(`/api/workspaces/${workspace.id}`, { user: leaver });
  assert.equal(lostAccess.response.status, 404);

  const ownerLeaves = await request(`/api/workspaces/${workspace.id}/members/${owner.id}`, {
    user: owner,
    method: 'DELETE',
  });
  assert.equal(ownerLeaves.response.status, 409);
  const ownerDemoted = await request(`/api/workspaces/${workspace.id}/members/${owner.id}`, {
    user: owner,
    method: 'PATCH',
    body: { role: 'member' },
  });
  assert.equal(ownerDemoted.response.status, 409);
  assert.equal(await membershipRole(workspace.id, owner.id), 'owner');
});

test('invitation listings never expose raw tokens or token hashes', async () => {
  const created = await inviteAs(owner, workspace.id, `${runId}-leak@example.test`);
  assert.equal(created.response.status, 201, created.data?.error?.message);
  const token = inviteToken(created);
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const listed = await request(`/api/workspaces/${workspace.id}/invitations`, { user: owner });
  assert.equal(listed.response.status, 200);
  const serialized = JSON.stringify(listed.data);
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes(tokenHash));
  assert.ok(!/token/i.test(serialized));

  assert.ok(!JSON.stringify(created.data.invitation).includes(tokenHash));
});
