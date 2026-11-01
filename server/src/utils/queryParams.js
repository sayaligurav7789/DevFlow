import { httpError } from './httpError.js';

export function assertKnownKeys(value, allowed, label = 'query') {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw httpError(400, `Unknown ${label} field: ${unknown}`);
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

export function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = positiveInteger(query.page, 1, 1_000_000);
  const limit = positiveInteger(query.limit, defaultLimit, maxLimit);
  if (page === null) throw httpError(400, 'page must be a positive integer');
  if (limit === null) throw httpError(400, `limit must be an integer between 1 and ${maxLimit}`);
  return { page, limit, offset: (page - 1) * limit };
}
