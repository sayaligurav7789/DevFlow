import { config } from '../config/env.js';

// Defensive headers for a JSON-only API (no HTML is ever served from here).
//  - nosniff / frame / CSP: nothing the API returns should be rendered, framed or executed.
//  - no-store: responses are per-user and authenticated; browsers and shared caches must not keep them.
//  - HSTS: only meaningful over HTTPS, so only sent in production (TLS is expected at the proxy).
export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
  });
  if (config.isProduction) {
    res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}
