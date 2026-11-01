// Refuses to start a production process with settings that are unsafe or certainly wrong.
// Pure function over plain objects so it can be unit-tested without touching the environment.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function productionConfigProblems(cfg, env = process.env) {
  const problems = [];

  if (!env.CLIENT_ORIGIN) {
    problems.push('CLIENT_ORIGIN must be set explicitly in production (the exact browser origin, e.g. https://app.example.com).');
  } else {
    try {
      const url = new URL(cfg.clientOrigin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== cfg.clientOrigin) {
        problems.push('CLIENT_ORIGIN must be a bare origin such as https://app.example.com (no path, trailing slash or wildcard).');
      } else if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
        problems.push('CLIENT_ORIGIN must use https:// in production unless it is localhost (session cookies are Secure).');
      }
    } catch {
      problems.push('CLIENT_ORIGIN is not a valid URL.');
    }
  }

  if (!env.API_ORIGIN) {
    problems.push('API_ORIGIN must be set explicitly in production (for OAuth callbacks, e.g. https://api.example.com).');
  } else {
    try {
      const apiUrl = new URL(cfg.apiOrigin);
      if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.origin !== cfg.apiOrigin) {
        problems.push('API_ORIGIN must be a bare origin such as https://api.example.com.');
      } else if (apiUrl.protocol !== 'https:' && !LOCAL_HOSTS.has(apiUrl.hostname)) {
        problems.push('API_ORIGIN must use https:// in production.');
      }
    } catch {
      problems.push('API_ORIGIN is not a valid URL.');
    }
  }
  const hasOAuthConfiguration = Boolean(
    env.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_SECRET || env.SLACK_CLIENT_ID || env.SLACK_CLIENT_SECRET,
  );
  if (hasOAuthConfiguration && !/^[a-f0-9]{64}$/i.test(env.INTEGRATIONS_ENCRYPTION_KEY || '')) {
    problems.push('INTEGRATIONS_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hexadecimal characters when OAuth integrations are configured.');
  }
  if (!cfg.database.password) problems.push('DEVFLOW_DB_PASSWORD must be set in production.');
  if (Buffer.byteLength(cfg.sessionSecret) < 32) problems.push('SESSION_SECRET must be at least 32 bytes.');
  return problems;
}
