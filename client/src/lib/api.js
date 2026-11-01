// Single HTTP layer for the Express API.
//  - Same-origin requests (Vite proxies /api in development).
//  - Double-submit CSRF: the token cookie is read per request and sent as X-CSRF-Token.
//  - Expired sessions: any 401 outside the auth screens triggers the registered handler.
//  - Server errors are normalised into ApiError with a human-readable message.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

function readCsrfCookie() {
  const match = document.cookie.split('; ').find((c) => c.startsWith('devflow_csrf='));
  return match ? decodeURIComponent(match.slice('devflow_csrf='.length)) : null;
}

let csrfInFlight = null;
async function ensureCsrfToken({ force = false } = {}) {
  if (!force) {
    const existing = readCsrfCookie();
    if (existing) return existing;
  }
  if (!csrfInFlight) {
    csrfInFlight = fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include' }).finally(() => {
      csrfInFlight = null;
    });
  }
  await csrfInFlight;
  return readCsrfCookie();
}

async function parse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toApiError(response, data) {
  const fallback = response.status >= 500 ? 'The server ran into a problem. Please try again.' : `Request failed (${response.status}).`;
  return new ApiError(data?.error?.message || fallback, response.status, data?.error?.details);
}

async function send(method, path, { body, signal, skipUnauthorized = false } = {}, retried = false) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = await ensureCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the DevFlow server. Check your connection and try again.', 0);
  }
  const data = await parse(response);
  if (response.ok) return data;

  if (response.status === 403 && method !== 'GET' && !retried && /csrf/i.test(data?.error?.message ?? '')) {
    await ensureCsrfToken({ force: true });
    return send(method, path, { body, signal, skipUnauthorized }, true);
  }
  if (response.status === 401 && !skipUnauthorized) unauthorizedHandler?.();
  throw toApiError(response, data);
}

export const apiGet = (path, options) => send('GET', path, options);
export const apiPost = (path, body, options) => send('POST', path, { ...options, body: body ?? {} });
export const apiPatch = (path, body, options) => send('PATCH', path, { ...options, body: body ?? {} });
export const apiPut = (path, body, options) => send('PUT', path, { ...options, body: body ?? {} });
export const apiDelete = (path, options) => send('DELETE', path, options);

// Builds ?a=1&b=2, dropping empty values. Arrays become comma lists (matches the API's enum filters).
export function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
