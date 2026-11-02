// Static checks of the deployment files, SQL migrations, seed script and secret hygiene.
// They read files only: no Docker, database or network is needed. They verify what the files SAY;
// whether an image builds and a container is healthy can only be shown by running Docker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverRoot, '..');
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), 'utf8');

const dockerfile = read('server', 'Dockerfile');
const compose = read('docker-compose.yml');

// ---- Dockerfile ----------------------------------------------------------------------------------

test('Dockerfile: supported even-numbered LTS Node base, multi-stage, reproducible install', () => {
  const major = Number(/^ARG NODE_VERSION=(\d+)$/m.exec(dockerfile)?.[1]);
  assert.ok(major >= 22 && major % 2 === 0, `NODE_VERSION default ${major} must be an LTS line (22, 24, ...)`);
  assert.match(dockerfile, /^FROM node:\$\{NODE_VERSION\}-[\w.-]+ AS deps$/m);
  assert.match(dockerfile, /^FROM node:\$\{NODE_VERSION\}-[\w.-]+ AS runtime$/m);
  assert.doesNotMatch(dockerfile, /node:[\w.-]*latest/);
  assert.match(dockerfile, /RUN npm ci --omit=dev/);
  assert.doesNotMatch(dockerfile, /RUN npm install/, 'npm install ignores the lockfile');
});

test('Dockerfile: unprivileged user, no baked-in secrets, exec-form start command, health check', () => {
  const lines = dockerfile.split('\n').filter((line) => !line.trim().startsWith('#'));
  const runtime = lines.slice(lines.findIndex((l) => /AS runtime/.test(l)));
  assert.ok(runtime.some((l) => l.trim() === 'USER node'), 'runtime stage must switch to the node user');
  assert.ok(runtime.findIndex((l) => l.trim() === 'USER node') > runtime.findIndex((l) => l.startsWith('COPY')), 'USER comes after the COPY steps');
  assert.ok(!lines.some((l) => /^\s*USER\s+(root|0)\b/.test(l)));

  for (const line of lines) {
    if (/^\s*(ENV|ARG)\b/.test(line) && /(SECRET|PASSWORD|TOKEN|PRIVATE|CREDENTIAL)/i.test(line)) {
      assert.fail(`secret-looking variable in the image definition: ${line.trim()}`);
    }
  }
  assert.ok(!lines.some((l) => /^\s*COPY\s+\.\s/.test(l)), 'must not COPY the whole context');
  assert.ok(!lines.some((l) => /COPY .*\.env/.test(l)));
  assert.ok(runtime.some((l) => /^CMD \["node", "src\/index\.js"\]$/.test(l.trim())), 'exec-form CMD so SIGTERM reaches Node');
  assert.ok(runtime.some((l) => /^HEALTHCHECK/.test(l.trim())));
  assert.ok(runtime.some((l) => /^ENV .*NODE_ENV=production/.test(l.trim()) || /NODE_ENV=production/.test(l)));
});

test('.dockerignore keeps secrets, dependencies and tests out of the image', () => {
  const entries = read('server', '.dockerignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const required of ['node_modules', '.env', '.env.*', 'test', 'test-support']) {
    assert.ok(entries.includes(required), `.dockerignore must list ${required}`);
  }
});

// ---- Compose -------------------------------------------------------------------------------------------

// Splits docker-compose.yml into its top-level service blocks (two-space indentation).
function serviceBlocks() {
  const body = compose.slice(compose.indexOf('\nservices:\n') + '\nservices:\n'.length);
  const end = body.search(/\n(networks|volumes):\n/);
  const text = end === -1 ? body : body.slice(0, end);
  const blocks = {};
  let current;
  for (const line of text.split('\n')) {
    const header = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (header) { current = header[1]; blocks[current] = ''; } else if (current) blocks[current] += `${line}\n`;
  }
  return blocks;
}

test('Compose: PostgreSQL and Redis always run; migrations and the API are an opt-in "app" profile', () => {
  const blocks = serviceBlocks();
  assert.deepEqual(Object.keys(blocks).sort(), ['backend', 'migrate', 'postgres', 'redis']);
  for (const name of ['migrate', 'backend']) assert.match(blocks[name], /profiles:\s*\["app"\]/, `${name} is opt-in`);
  for (const name of ['postgres', 'redis']) assert.doesNotMatch(blocks[name], /profiles:/, `${name} stays in the default set`);
});

test('Compose: every long-running service has a health check, and start order follows health', () => {
  const blocks = serviceBlocks();
  for (const name of ['postgres', 'redis', 'backend']) assert.match(blocks[name], /healthcheck:\s*\n\s+test:/, `${name} health check`);
  assert.match(blocks.backend, /postgres:\s*\n\s+condition: service_healthy/);
  assert.match(blocks.backend, /redis:\s*\n\s+condition: service_healthy/);
  assert.match(blocks.backend, /migrate:\s*\n\s+condition: service_completed_successfully/);
  assert.match(blocks.migrate, /postgres:\s*\n\s+condition: service_healthy/);
  assert.match(blocks.migrate, /restart: "no"/, 'the migration job must not restart in a loop');
});

test('Compose: credentials come from the environment; nothing secret is written in the file', () => {
  for (const line of compose.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    if (/(PASSWORD|SECRET|TOKEN)\w*:\s*\S/.test(line)) {
      assert.match(line, /\$\{[A-Z_]+(:[-?][^}]*)?\}/, `must be interpolated, not literal: ${line.trim()}`);
    }
  }
  assert.match(compose, /POSTGRES_PASSWORD: \$\{DEVFLOW_DB_PASSWORD:\?/, 'the database password is mandatory');
  assert.doesNotMatch(compose, /:latest\b/);
  assert.match(compose, /image: postgres:\d+/);
  assert.match(compose, /image: redis:\d+/);
});

test('Compose: published ports are loopback-only, data persists in named volumes, services share a private network', () => {
  // Port mappings are the quoted list items ending in a container port, e.g. "127.0.0.1:${PORT:-5432}:5432".
  const ports = [...compose.matchAll(/^\s+- "([^"]*:\d+)"\s*$/gm)].map((m) => m[1]);
  assert.ok(ports.length >= 3, 'postgres, redis and backend publish a port');
  for (const mapping of ports) assert.match(mapping, /^127\.0\.0\.1:/, `${mapping} must bind to loopback`);
  assert.match(compose, /postgres_data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /redis_data:\/data/);
  assert.match(compose, /^volumes:\s*\n\s+postgres_data:\s*\n\s+redis_data:/m);
  const blocks = serviceBlocks();
  for (const name of Object.keys(blocks)) assert.match(blocks[name], /networks:\s*\n\s+- backend/, `${name} joins the backend network`);
  assert.match(compose, /^networks:\s*\n(?:\s+#[^\n]*\n)*\s+backend:/m);
  assert.match(compose, /DEVFLOW_DB_HOST: postgres/);
  assert.match(compose, /DEVFLOW_REDIS_HOST: redis/);
});

test('Compose: containers are not privileged and the app containers are locked down', () => {
  assert.doesNotMatch(compose, /privileged:\s*true/);
  assert.doesNotMatch(compose, /network_mode:\s*host/);
  assert.doesNotMatch(compose, /docker\.sock/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop:\s*\n\s+- ALL/);
  assert.match(compose, /no-new-privileges:true/);
});

// ---- Migrations and seed ---------------------------------------------------------------------------------

const migrationsDirectory = path.join(serverRoot, 'db', 'migrations');
const migrationFiles = readdirSync(migrationsDirectory).filter((f) => f.endsWith('.sql')).sort();

test('migrations: valid names, consecutive numbering from 001, no gaps or duplicates', () => {
  assert.ok(migrationFiles.length >= 6);
  migrationFiles.forEach((name, index) => {
    assert.match(name, /^\d{3,}_[a-z0-9_]+\.sql$/, name);
    assert.equal(Number(name.slice(0, 3)), index + 1, `${name} should be number ${index + 1}`);
  });
});

test('migrations: never drop or empty tables, databases or schemas', () => {
  for (const name of migrationFiles) {
    const sql = readFileSync(path.join(migrationsDirectory, name), 'utf8').replace(/--[^\n]*/g, '');
    for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bDROP\s+DATABASE\b/i, /\bDROP\s+SCHEMA\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bDROP\s+OWNED\b/i]) {
      assert.doesNotMatch(sql, forbidden, `${name} contains destructive SQL`);
    }
    assert.doesNotMatch(sql, /\b(password|secret)\b\s*(=|:)\s*'[^']+'/i, `${name} must not contain credentials`);
  }
});

test('migration runner: checksum-protected, transactional, serialised, never drops anything itself', () => {
  const runner = readFileSync(path.join(serverRoot, 'src', 'db', 'migrate.js'), 'utf8');
  assert.match(runner, /pg_advisory_lock/);
  assert.match(runner, /Applied migration was modified/);
  assert.match(runner, /BEGIN/);
  assert.match(runner, /ROLLBACK/);
  assert.doesNotMatch(runner, /DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE/i);
});

test('seed script: idempotent inserts, no credentials, refuses production', () => {
  const seed = readFileSync(path.join(serverRoot, 'src', 'db', 'seed.js'), 'utf8');
  const inserts = (seed.match(/INSERT INTO/g) ?? []).length;
  const guards = (seed.match(/ON CONFLICT|WHERE NOT EXISTS/g) ?? []).length;
  assert.ok(inserts > 0 && guards >= inserts, `every INSERT needs ON CONFLICT or NOT EXISTS (${inserts} inserts, ${guards} guards)`);
  assert.doesNotMatch(seed, /password_hash/, 'the seed user must not be able to log in');
  assert.doesNotMatch(seed, /DROP\s|TRUNCATE|DELETE\s+FROM/i);
  assert.match(seed, /config\.isProduction/);
});

// ---- Secret hygiene ------------------------------------------------------------------------------------------

function textFiles() {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return tracked
    .split('\0')
    .filter(Boolean)
    .filter((file) => !/package-lock\.json$|\.(png|jpe?g|gif|ico|woff2?|svg|zip)$/i.test(file))
    .map((file) => path.join(repoRoot, file));
}

test('no credentials or private keys are committed in application, config or documentation files', () => {
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
    [/\b(postgres(ql)?|redis|mongodb(\+srv)?):\/\/[^\s:@/]+:(?![$<{])[^\s@/]+@/, 'connection string with an inline password'],
    [/\b(SESSION_SECRET|DEVFLOW_DB_PASSWORD|DEVFLOW_REDIS_PASSWORD|API_KEY|SECRET_KEY)\s*[:=]\s*['"]?[A-Za-z0-9+/_-]{16,}/, 'secret assignment'],
    [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
    [/\bsk-[A-Za-z0-9]{32,}\b/, 'API secret key'],
  ];
  const hits = [];
  for (const file of textFiles()) {
    const content = readFileSync(file, 'utf8');
    for (const [pattern, label] of patterns) if (pattern.test(content)) hits.push(`${path.relative(repoRoot, file)}: ${label}`);
  }
  assert.deepEqual(hits, []);
});

test('real .env files are ignored by Git and only the *.env.example templates are tracked', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  for (const template of [['server', '.env.example'], ['client', '.env.example']]) {
    const content = read(...template);
    assert.doesNotMatch(content, /^(SESSION_SECRET|DEVFLOW_DB_PASSWORD)=\S/m, `${template.join('/')} must not contain real values`);
  }
  if (existsSync(path.join(repoRoot, '.git'))) {
    let tracked;
    try { tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).split('\n'); } catch { return; }
    const leaked = tracked.filter((file) => /(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example'));
    assert.deepEqual(leaked, [], 'a real env file is tracked by Git');
  }
});

// ---- Lockfile (what `npm ci` in the Docker build needs) -------------------------------------------------------

test('lockfiles reference only the public npm registry, never a private or local mirror', () => {
  for (const name of [['server', 'package-lock.json'], ['client', 'package-lock.json']]) {
    const urls = [...read(...name).matchAll(/"resolved":\s*"(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).host);
    assert.deepEqual([...new Set(urls)].filter((host) => host !== 'registry.npmjs.org'), [], `${name.join('/')} resolves packages from a non-public host`);
  }
});

test('server/package-lock.json is in sync with server/package.json (required by `npm ci` in the Docker build)', () => {
  const manifest = JSON.parse(read('server', 'package.json'));
  const lock = JSON.parse(read('server', 'package-lock.json'));
  const root = lock.packages[''];
  assert.deepEqual(root.dependencies ?? {}, manifest.dependencies ?? {},
    'dependencies differ between package.json and the lockfile: run `npm install --prefix server` and commit the updated package-lock.json');
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    assert.ok(lock.packages[`node_modules/${name}`], `${name} is missing from the lockfile`);
  }
});
