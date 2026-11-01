// Look up a user-supplied key in an allowlist object. Only the allowlist's OWN properties count:
// a plain `map[key]` also "finds" inherited names such as constructor and __proto__, which would
// otherwise pass a truthiness check and be interpolated into SQL (for example into ORDER BY).
export function allowlistedValue(allowlist, key) {
  return typeof key === 'string' && Object.hasOwn(allowlist, key) ? allowlist[key] : undefined;
}
