// Verifies the SQL migrations and the seed script against real PostgreSQL.
//
//  Part A runs against the configured *_test database and checks that the migration runner is
//  idempotent, serialised, and refuses tampered, badly named or failing migrations.
//  Part B creates a brand-new temporary database, runs `node src/db/migrate.js` and
//  `node src/db/seed.js` as real child processes (exactly how Docker and developers run them),
//  checks the resulting schema and constraints, then drops the temporary database again.
//
// Requires PostgreSQL. Part B also needs the CREATEDB privilege (the Docker Compose user has it)
// and is skipped, with a message, if the CREATE DATABASE statement is refused.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import pg from 'pg';

process.env.NODE_ENV = 'test';
const { config } = await import('../src/config/env.js');
const { pool } = await import('../src/db/pool.js');
const { runMigrations } = await import('../src/db/migrate.js');

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(serverRoot, 'db', 'migrations');
const tempDatabase = `devflow_migtest_${randomBytes(5).toString('hex')}`;
const scratch = [];
let migrationFiles;
let tempDatabaseReady = false;
let tempSkipReason = 'temporary database was not created';

const connection = (database) => ({
  host: config.database.host, port: config.database.port, user: config.database.user,
  password: config.database.password, database,
});

before(async () => {
  if (!config.database.name.endsWith('_test')) {
    throw new Error('Refusing to run unless DEVFLOW_DB_NAME ends with _test.');
  }
  migrationFiles = (await readdir(migrationsDirectory)).filter((f) => f.endsWith('.sql')).sort();
  await runMigrations();

  const admin = new pg.Client(connection(config.database.name));
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${tempDatabase}"`);
    tempDatabaseReady = true;
  } catch (error) {
    tempSkipReason = `cannot create a temporary database (${error.message})`;
  } finally {
    await admin.end().catch(() => {});
  }
});

after(async () => {
  for (const directory of scratch) await rm(directory, { recursive: true, force: true });
  if (tempDatabaseReady) {
    const admin = new pg.Client(connection(config.database.name));
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${tempDatabase}" WITH (FORCE)`);
    await admin.end();
  }
  await pool.end();
});

async function copyOfMigrations() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devflow-migrations-'));
  scratch.push(directory);
  await cp(migrationsDirectory, directory, { recursive: true });
  return directory;
}

const appliedRows = async () => (await pool.query('SELECT name, checksum FROM schema_migrations ORDER BY name')).rows;

// ---- Part A: the runner, on the shared test database ------------------------------------------------

test('running migrations again is a no-op and every applied checksum matches its file', async () => {
  const before = await appliedRows();
  await runMigrations();
  await runMigrations();
  const after = await appliedRows();
  assert.deepEqual(after, before);
  assert.deepEqual(after.map((row) => row.name), migrationFiles);
  for (const row of after) {
    const { createHash } = await import('node:crypto');
    const sql = await readFile(path.join(migrationsDirectory, row.name), 'utf8');
    assert.equal(row.checksum, createHash('sha256').update(sql).digest('hex'), row.name);
  }
});

test('two migration runs at the same time are serialised by the advisory lock', async () => {
  await Promise.all([runMigrations(), runMigrations(), runMigrations()]);
  assert.equal((await appliedRows()).length, migrationFiles.length);
});

test('an already-applied migration that was edited is rejected and nothing changes', async () => {
  const directory = await copyOfMigrations();
  const first = path.join(directory, migrationFiles[0]);
  await writeFile(first, `${await readFile(first, 'utf8')}\n-- edited after being applied\n`);
  const before = await appliedRows();
  await assert.rejects(runMigrations(directory), /Applied migration was modified: 001_/);
  assert.deepEqual(await appliedRows(), before);
});

test('files that do not follow the naming rule are rejected', async () => {
  const directory = await copyOfMigrations();
  await writeFile(path.join(directory, 'add-things.sql'), 'SELECT 1;');
  await assert.rejects(runMigrations(directory), /Invalid migration filename: add-things\.sql/);
});

test('a failing migration is rolled back completely and is not recorded', async () => {
  const directory = await copyOfMigrations();
  await writeFile(
    path.join(directory, '999_broken_probe.sql'),
    'CREATE TABLE migration_probe_should_not_exist (id INTEGER);\nSELECT * FROM table_that_does_not_exist;\n',
  );
  await assert.rejects(runMigrations(directory), /Migration 999_broken_probe\.sql failed and was rolled back/);
  const table = await pool.query("SELECT to_regclass('public.migration_probe_should_not_exist') AS name");
  assert.equal(table.rows[0].name, null, 'the half-applied table must not survive');
  assert.ok(!(await appliedRows()).some((row) => row.name.startsWith('999')));
  await runMigrations();
});

// ---- Part B: from scratch, with real child processes ----------------------------------------------------------

function run(script, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(serverRoot, 'src', 'db', script)],
      { cwd: serverRoot, env: { ...process.env, NODE_ENV: 'test', DEVFLOW_DB_NAME: tempDatabase, ...extraEnv }, timeout: 60_000 },
      (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

async function withTempDatabase(callback) {
  const client = new pg.Client(connection(tempDatabase));
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

const sqlState = async (promise) => promise.then(() => null, (error) => error.code);

test('a fresh database migrates cleanly, then a second run changes nothing', async (t) => {
  if (!tempDatabaseReady) return t.skip(tempSkipReason);
  const first = await run('migrate.js');
  assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
  for (const file of migrationFiles) assert.match(first.stdout, new RegExp(`Applied migration ${file}`));
  assert.match(first.stdout, /Database migrations are up to date/);

  const second = await run('migrate.js');
  assert.equal(second.code, 0, `${second.stdout}\n${second.stderr}`);
  assert.doesNotMatch(second.stdout, /Applied migration/);

  await withTempDatabase(async (db) => {
    const names = (await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);
    assert.deepEqual(names, migrationFiles);
    const tables = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.table_name);
    for (const expected of ['users', 'workspaces', 'workspace_members', 'workspace_invitations', 'projects', 'tasks', 'activity_logs', 'sessions', 'notifications', 'account_action_tokens', 'schema_migrations']) {
      assert.ok(tables.includes(expected), `missing table ${expected}`);
    }
  });
});

test('the schema enforces the constraints the application relies on', async (t) => {
  if (!tempDatabaseReady) return t.skip(tempSkipReason);
  await withTempDatabase(async (db) => {
    const id = async (sql, params) => (await db.query(`${sql} RETURNING id::TEXT AS id`, params)).rows[0].id;
    const email = `schema-${randomBytes(3).toString('hex')}@example.test`;
    const userId = await id('INSERT INTO users (email, display_name) VALUES ($1, $2)', [email, 'Schema']);

    // The API maps this exact constraint name to its "email already exists" response.
    const duplicate = await db.query('INSERT INTO users (email, display_name) VALUES ($1, $2)', [email, 'Dup']).catch((e) => e);
    assert.equal(duplicate.code, '23505');
    assert.equal(duplicate.constraint, 'users_email_key');

    assert.equal(await sqlState(db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('not-a-hash', $1, NOW())", [userId])), '23514', 'session hash format');
    assert.equal(await sqlState(db.query("INSERT INTO users (email, display_name) VALUES ('blank@example.test', '   ')")), '23514', 'blank display name');

    const workspaceId = await id('INSERT INTO workspaces (slug, name, created_by) VALUES ($1, $2, $3)', [`ws-${randomBytes(3).toString('hex')}`, 'W', userId]);
    await db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspaceId, userId]);
    assert.equal(await sqlState(db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspaceId, userId])), '23505', 'one membership per user per workspace');
    assert.equal(await sqlState(db.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'superuser')", [workspaceId, userId])), '23514', 'role allowlist');

    const projectId = await id('INSERT INTO projects (workspace_id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [workspaceId, 'p', 'P', userId]);
    assert.equal(await sqlState(db.query('INSERT INTO projects (workspace_id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [workspaceId, 'p', 'P2', userId])), '23505', 'project slug unique per workspace');
    assert.equal(await sqlState(db.query("INSERT INTO tasks (project_id, title, status, created_by, reporter_id) VALUES ($1, 'x', 'bogus', $2, $2)", [projectId, userId])), '23514', 'task status allowlist');
    assert.equal(await sqlState(db.query("INSERT INTO tasks (project_id, title, priority, created_by, reporter_id) VALUES ($1, 'x', 'bogus', $2, $2)", [projectId, userId])), '23514', 'task priority allowlist');
  });
});

test('notifications: constraints, de-duplication, and the right cascade rules', async (t) => {
  if (!tempDatabaseReady) return t.skip(tempSkipReason);
  await withTempDatabase(async (db) => {
    const make = async (label) => (await db.query('INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id::TEXT AS id', [`${label}-${randomBytes(3).toString('hex')}@example.test`, label])).rows[0].id;
    const recipient = await make('recipient');
    const actor = await make('actor');
    const workspace = (await db.query('INSERT INTO workspaces (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id::TEXT AS id', [`n-${randomBytes(3).toString('hex')}`, 'N', recipient])).rows[0].id;
    const insert = (overrides = {}) => {
      const row = { type: 'task.assigned', message: 'hello', data: '{}', dedupe: null, ...overrides };
      return db.query(
        `INSERT INTO notifications (user_id, workspace_id, actor_id, type, entity_type, message, data, dedupe_key)
         VALUES ($1, $2, $3, $4, 'task', $5, $6::JSONB, $7) RETURNING id::TEXT AS id`,
        [recipient, workspace, actor, row.type, row.message, row.data, row.dedupe],
      );
    };

    assert.equal(await sqlState(insert({ type: 'task.exploded' })), '23514', 'type allowlist');
    assert.equal(await sqlState(insert({ message: '' })), '23514', 'message not empty');
    assert.equal(await sqlState(insert({ message: 'x'.repeat(501) })), '23514', 'message length cap');
    assert.equal(await sqlState(insert({ data: '[]' })), '23514', 'data must be a JSON object');
    assert.equal(await sqlState(insert({ data: '"text"' })), '23514');

    await insert({ dedupe: 'once' });
    assert.equal(await sqlState(insert({ dedupe: 'once' })), '23505', 'the same dedupe key cannot be stored twice for one user');
    await insert();
    await insert(); // several rows without a dedupe key are fine

    const unread = (await db.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'notifications_user_unread_idx'")).rows[0].indexdef;
    assert.match(unread, /WHERE \(read_at IS NULL\)/, 'unread index is partial');

    const rules = (await db.query(
      `SELECT a.attname AS column, c.confdeltype AS rule
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
       WHERE c.conrelid = 'notifications'::regclass AND c.contype = 'f'`,
    )).rows.reduce((acc, r) => ({ ...acc, [r.column]: r.rule }), {});
    assert.deepEqual(rules, { user_id: 'c', workspace_id: 'c', actor_id: 'n', project_id: 'n' }, 'c = cascade, n = set null');

    // Behaviour, not just metadata: deleting the actor keeps the notification; deleting the workspace removes it.
    await db.query('DELETE FROM users WHERE id = $1', [actor]);
    const kept = await db.query('SELECT COUNT(*)::INT AS n, COUNT(actor_id)::INT AS withActor FROM notifications WHERE user_id = $1', [recipient]);
    assert.ok(kept.rows[0].n >= 3 && kept.rows[0].withactor === 0);
    await db.query('DELETE FROM workspaces WHERE id = $1', [workspace]);
    assert.equal((await db.query('SELECT COUNT(*)::INT AS n FROM notifications WHERE user_id = $1', [recipient])).rows[0].n, 0);
  });
});

test('the seed script is idempotent, creates a user who cannot sign in, and refuses production', async (t) => {
  if (!tempDatabaseReady) return t.skip(tempSkipReason);
  const seedEmail = `seed-${randomBytes(3).toString('hex')}@local.test`;
  const env = { DEVFLOW_SEED_EMAIL: seedEmail };

  const first = await run('seed.js', env);
  assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
  const counts = () => withTempDatabase(async (db) => {
    const one = async (sql, params) => (await db.query(sql, params)).rows[0].n;
    return {
      users: await one('SELECT COUNT(*)::INT AS n FROM users WHERE email = $1', [seedEmail]),
      workspaces: await one("SELECT COUNT(*)::INT AS n FROM workspaces WHERE slug = 'devflow-local'"),
      projects: await one("SELECT COUNT(*)::INT AS n FROM projects WHERE slug = 'getting-started'"),
      tasks: await one("SELECT COUNT(*)::INT AS n FROM tasks WHERE title = 'Plan the next DevFlow milestone'"),
      owners: await one("SELECT COUNT(*)::INT AS n FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE w.slug = 'devflow-local' AND m.role = 'owner'"),
      passwords: await one('SELECT COUNT(password_hash)::INT AS n FROM users WHERE email = $1', [seedEmail]),
    };
  });
  const afterFirst = await counts();
  assert.deepEqual(afterFirst, { users: 1, workspaces: 1, projects: 1, tasks: 1, owners: 1, passwords: 0 });

  const second = await run('seed.js', env);
  const third = await run('seed.js', env);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(third.code, 0, third.stderr);
  assert.deepEqual(await counts(), afterFirst, 'seeding again must not duplicate anything');

  const refused = await run('seed.js', { ...env, NODE_ENV: 'production' });
  assert.notEqual(refused.code, 0);
  assert.match(`${refused.stdout}${refused.stderr}`, /Refusing to seed a production database/);
  assert.deepEqual(await counts(), afterFirst);
});

test('migrations never touch existing data: re-running them leaves rows intact', async (t) => {
  if (!tempDatabaseReady) return t.skip(tempSkipReason);
  const marker = `keep-${randomBytes(3).toString('hex')}@example.test`;
  await withTempDatabase((db) => db.query('INSERT INTO users (email, display_name) VALUES ($1, $2)', [marker, 'Keep me']));
  assert.equal((await run('migrate.js')).code, 0);
  const rows = await withTempDatabase((db) => db.query('SELECT display_name FROM users WHERE email = $1', [marker]));
  assert.deepEqual(rows.rows, [{ display_name: 'Keep me' }]);
});
