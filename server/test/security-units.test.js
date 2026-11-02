// Security-relevant building blocks, tested directly. No database, Redis or HTTP server needed.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = `unit-test-${'x'.repeat(40)}`;

const [csrf, session, { errorHandler, statusFor }, { securityHeaders }, { productionConfigProblems }, access, pagination] = await Promise.all([
  import('../src/middleware/csrfProtection.js'),
  import('../src/auth/session.js'),
  import('../src/middleware/errorHandler.js'),
  import('../src/middleware/securityHeaders.js'),
  import('../src/config/validate.js'),
  import('../src/services/workspaceAccess.service.js'),
  import('../src/utils/queryParams.js'),
]);

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, cookies: [], body: undefined, headersSent: false,
    set(nameOrObject, value) {
      if (typeof nameOrObject === 'object') Object.assign(res.headers, nameOrObject);
      else res.headers[nameOrObject] = value;
      return res;
    },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    cookie(name, value, options) { res.cookies.push({ name, value, options }); return res; },
    clearCookie(name, options) { res.cookies.push({ name, cleared: true, options }); return res; },
  };
  return res;
}

// ---- CSRF ------------------------------------------------------------------------------------

test('CSRF tokens validate when untouched and fail when forged, truncated or re-signed', () => {
  const token = csrf.createCsrfToken();
  assert.equal(csrf.isValidCsrfToken(token), true);
  assert.notEqual(token, csrf.createCsrfToken(), 'tokens are random');

  const [nonce, signature] = token.split('.');
  const flip = (text) => `${text.slice(0, -1)}${text.endsWith('A') ? 'B' : 'A'}`;
  for (const bad of [
    `${nonce}.${flip(signature)}`, `${flip(nonce)}.${signature}`, nonce, `${token}.extra`, '', '.', `${nonce}.`,
    `${'A'.repeat(43)}.${signature}`, undefined, null, 42, {}, [token],
  ]) {
    assert.equal(csrf.isValidCsrfToken(bad), false, `must reject ${JSON.stringify(bad)}`);
  }
});

test('CSRF middleware lets safe methods through and blocks unsafe ones without a matching signed token', () => {
  const run = (method, cookie, header) => {
    const res = mockRes();
    let passed = false;
    const req = {
      method,
      headers: { cookie: cookie === undefined ? '' : `${session.CSRF_COOKIE_NAME}=${cookie}` },
      get: (name) => (name.toLowerCase() === 'x-csrf-token' ? header : undefined),
    };
    csrf.csrfProtection(req, res, () => { passed = true; });
    return { passed, status: res.statusCode };
  };
  const token = csrf.createCsrfToken();
  const forged = `${'A'.repeat(43)}.${'B'.repeat(43)}`;

  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(run(method).passed, true, method);
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.deepEqual(run(method, token, token), { passed: true, status: 200 }, `${method} with matching token`);
    assert.equal(run(method).status, 403, `${method} with no token`);
    assert.equal(run(method, token).status, 403, `${method} cookie only`);
    assert.equal(run(method, undefined, token).status, 403, `${method} header only`);
    assert.equal(run(method, token, csrf.createCsrfToken()).status, 403, `${method} cookie/header mismatch`);
    assert.equal(run(method, forged, forged).status, 403, `${method} matching but unsigned (cookie injection)`);
  }
});

// ---- Cookies and sessions ------------------------------------------------------------------------

test('session cookie is HttpOnly, SameSite=Lax, scoped to /api and expires with the session', () => {
  const res = mockRes();
  session.setSessionCookie(res, session.createSessionToken());
  const { name, options } = res.cookies[0];
  assert.equal(name, session.SESSION_COOKIE_NAME);
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/api');
  assert.equal(options.maxAge, session.SESSION_TTL_MS);
  assert.equal(options.secure, false, 'Secure is only set in production (see production-config.test.js)');
});

test('CSRF cookie is readable by the page (double-submit) but SameSite=Strict', () => {
  const res = mockRes();
  csrf.setCsrfCookie(res, csrf.createCsrfToken());
  const { options } = res.cookies[0];
  assert.equal(options.httpOnly, false);
  assert.equal(options.sameSite, 'strict');
  assert.equal(options.path, '/');
});

test('clearing cookies uses the same attributes as setting them', () => {
  const res = mockRes();
  session.clearSessionCookie(res);
  session.clearCsrfCookie(res);
  assert.deepEqual(res.cookies.map((c) => [c.name, c.options.path]), [[session.SESSION_COOKIE_NAME, '/api'], [session.CSRF_COOKIE_NAME, '/']]);
});

test('session tokens are 256-bit random, URL-safe, and only their SHA-256 hash is meant to be stored', () => {
  const a = session.createSessionToken();
  const b = session.createSessionToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  const hash = session.hashSessionToken(a);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, session.hashSessionToken(a));
  assert.notEqual(hash, a);
  assert.equal(session.SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test('readCookie picks the right cookie and survives malformed input', () => {
  const read = (cookie, name = 'devflow_session') => session.readCookie({ headers: { cookie } }, name);
  assert.equal(read('a=1; devflow_session=abc; b=2'), 'abc');
  assert.equal(read('devflow_session=a%20b'), 'a b');
  assert.equal(read('devflow_session=%E0%A4%A'), null, 'invalid percent-encoding is ignored, not thrown');
  assert.equal(read('other=1'), null);
  assert.equal(read(''), null);
  assert.equal(session.readCookie({ headers: {} }, 'x'), null);
  assert.equal(read('xdevflow_session=evil; devflow_session=good'), 'good', 'name must match exactly');
});

// ---- Error handling -----------------------------------------------------------------------------

test('only real HTTP error statuses are honoured', () => {
  for (const [input, expected] of [[400, 400], [404, 404], [599, 599], [0, 500], [200, 500], [302, 500], [99999, 500], ['404', 500], [NaN, 500], [undefined, 500]]) {
    assert.equal(statusFor({ status: input }), expected, `status ${String(input)}`);
  }
  assert.equal(statusFor({ statusCode: 413 }), 413);
  assert.equal(statusFor(null), 500);
});

test('error handler never echoes request content for body-parser errors', () => {
  const secret = 'password=hunter2';
  for (const [type, status] of [['entity.parse.failed', 400], ['entity.too.large', 413], ['encoding.unsupported', 415], ['charset.unsupported', 415]]) {
    const res = mockRes();
    errorHandler(Object.assign(new Error(`Unexpected token in ${secret}`), { type, status }), {}, res, () => {});
    assert.equal(res.statusCode, status);
    assert.ok(!JSON.stringify(res.body).includes('hunter2'), type);
  }
});

test('error handler returns application error messages for 4xx and defers when headers were already sent', () => {
  const res = mockRes();
  errorHandler(Object.assign(new Error('Project not found'), { status: 404 }), {}, res, () => {});
  assert.deepEqual([res.statusCode, res.body], [404, { error: { message: 'Project not found' } }]);

  const sent = mockRes();
  sent.headersSent = true;
  let forwarded;
  const error = new Error('late');
  errorHandler(error, {}, sent, (e) => { forwarded = e; });
  assert.equal(forwarded, error);
  assert.equal(sent.body, undefined);
});

// ---- Headers --------------------------------------------------------------------------------------

test('API responses carry defensive headers and are never cacheable', () => {
  const res = mockRes();
  let called = false;
  securityHeaders({}, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'/);
  assert.equal(res.headers['Strict-Transport-Security'], undefined, 'HSTS only in production');
});

// ---- Production config validation ------------------------------------------------------------------

test('production config validation accepts a sound config and names every problem otherwise', () => {
  const good = {
  clientOrigin: 'https://app.example.com',
  apiOrigin: 'https://api.example.com',
  sessionSecret: 'x'.repeat(40),
  database: { password: 'pw' },
};

const validEnv = {
  CLIENT_ORIGIN: 'https://app.example.com',
  API_ORIGIN: 'https://api.example.com',
};

assert.deepEqual(productionConfigProblems(good, validEnv), []);

assert.deepEqual(
  productionConfigProblems(
    { ...good, clientOrigin: 'http://localhost:5173' },
    { ...validEnv, CLIENT_ORIGIN: 'http://localhost:5173' }
  ),
  [],
  'http is fine for localhost'
);

  const cases = [
    [{}, {}, /CLIENT_ORIGIN must be set/],
    [{ clientOrigin: '*' }, { CLIENT_ORIGIN: '*' }, /valid URL|bare origin/],
    [{ clientOrigin: 'https://app.example.com/' }, { CLIENT_ORIGIN: 'x' }, /bare origin/],
    [{ clientOrigin: 'https://app.example.com/path' }, { CLIENT_ORIGIN: 'x' }, /bare origin/],
    [{ clientOrigin: 'http://app.example.com' }, { CLIENT_ORIGIN: 'x' }, /https/],
    [{ clientOrigin: 'ftp://app.example.com' }, { CLIENT_ORIGIN: 'x' }, /bare origin/],
    [{ database: { password: '' } }, { CLIENT_ORIGIN: 'x' }, /DEVFLOW_DB_PASSWORD/],
    [{ sessionSecret: 'short' }, { CLIENT_ORIGIN: 'x' }, /SESSION_SECRET/],
  ];
  for (const [override, env, pattern] of cases) {
    const problems = productionConfigProblems({ ...good, ...override }, env);
    assert.ok(problems.some((p) => pattern.test(p)), `${JSON.stringify(override)} -> ${JSON.stringify(problems)}`);
  }
});

// ---- Identifier and pagination validation ------------------------------------------------------------

test('database ids are strictly validated before they reach SQL', () => {
  for (const ok of ['1', '42', '9223372036854775807']) assert.equal(access.isValidBigintId(ok), true, ok);
  for (const bad of ['0', '-1', '01', '1.5', '1e3', ' 1', '1 ', '9223372036854775808', '99999999999999999999', '1;DROP TABLE users', "1' OR '1'='1", '', null, undefined, 1, [], {}, ['1']]) {
    assert.equal(access.isValidBigintId(bad), false, `must reject ${JSON.stringify(bad)}`);
  }
});

test('pagination rejects out-of-range and non-numeric values', () => {
  assert.deepEqual(pagination.parsePagination({}), { page: 1, limit: 20, offset: 0 });
  assert.deepEqual(pagination.parsePagination({ page: '3', limit: '10' }), { page: 3, limit: 10, offset: 20 });
  for (const query of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'x' }, { limit: '101' }, { limit: '0' }, { limit: ['1', '2'] }, { page: '1000001' }]) {
    assert.throws(() => pagination.parsePagination(query), (e) => e.status === 400, JSON.stringify(query));
  }
});

// ---- Static SQL audit ------------------------------------------------------------------------------------

// Every ${...} inside an SQL template literal must be on this list. Each entry is either a fixed SQL
// fragment built from constants, a placeholder number ($1, $2...), or a clause list whose items are
// fixed strings (values always travel as bound parameters). A new interpolation fails this test
// until a reviewer has checked where its value comes from and added it here deliberately.
const REVIEWED_INTERPOLATIONS = new Set([
  'ACTIVITY_SELECT', 'ACTIVITY_ORDER', "where.join(' AND ')", 'where', "filters.join(' AND ')", "sets.join(', ')",
  'values.length', 'values.length + 1', 'values.length + 2', 'values.length - 1', 'TODAY_SQL',
  'projectRowQuery()', 'TASK_COLUMNS_SQL', 'TASK_JOINS_SQL', 'TASK_ROW_SELECT', 'NOTIFICATION_SELECT',
  'COMMON_JOINS', 'COMMON_FILTER', "tuples.join(', ')", 'scope',
  // Sort column: must come from allowlistedValue(*_SORTS, ...); enforced by the next test.
  'sortColumn', 'sortOrder.toUpperCase()', "sortBy === 'dueAt' ? ' NULLS LAST' : ''",
  "archived ? 'COALESCE(archived_at, NOW())' : 'NULL'", "lock ? 'FOR UPDATE OF p, wm' : ''",
]);

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.js') ? [full] : [];
  });
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_WORDS = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|WHERE|ORDER\s+BY|LIMIT)\b/;

test('static SQL audit: every interpolation into SQL is on the reviewed list', () => {
  const unreviewed = [];
  for (const file of sourceFiles(path.join(serverRoot, 'src'))) {
    const code = readFileSync(file, 'utf8');
    for (const match of code.matchAll(/`([^`]*)`/gs)) {
      if (!SQL_WORDS.test(match[1])) continue;
      for (const [, expression] of match[1].matchAll(/\$\{([^}]*)\}/g)) {
        if (!REVIEWED_INTERPOLATIONS.has(expression.trim())) {
          unreviewed.push(`${path.relative(serverRoot, file)}: \${${expression}}`);
        }
      }
    }
  }
  assert.deepEqual(unreviewed, [], 'review these interpolations for injection risk, then add them to the list');
});

test('static SQL audit: sort columns only come from allowlists, and SQL is never concatenated', () => {
  for (const file of sourceFiles(path.join(serverRoot, 'src'))) {
    const code = readFileSync(file, 'utf8');
    for (const [, assignment] of code.matchAll(/const sortColumn = ([^;]+);/g)) {
      assert.match(assignment, /^allowlistedValue\(\w+_SORTS, \w+\)$/, `${path.basename(file)}: ${assignment}`);
    }
    assert.ok(!/\.query\(\s*(['"])[^'"]*\1\s*\+/.test(code), `${path.basename(file)} concatenates strings into .query()`);
    assert.ok(!/\.query\(\s*\w+\s*\+/.test(code), `${path.basename(file)} concatenates into .query()`);
  }
});

test('static audit: no ORM or query-builder dependency is present', () => {
  const manifest = JSON.parse(readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
  const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const forbidden = /^(prisma|@prisma\/.*|sequelize|typeorm|drizzle-orm|knex|objection|mikro-orm|@mikro-orm\/.*|bookshelf|waterline)$/;
  assert.deepEqual(dependencies.filter((name) => forbidden.test(name)), []);
});
