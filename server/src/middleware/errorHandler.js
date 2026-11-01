import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Body-parser failures carry the offending input in their message; answer with fixed text instead
// of echoing the request back.
const BODY_PARSER_ERRORS = Object.freeze({
  'entity.parse.failed': [400, 'Request body is not valid JSON'],
  'entity.too.large': [413, 'Request body is too large'],
  'encoding.unsupported': [415, 'Unsupported content encoding'],
  'charset.unsupported': [415, 'Unsupported charset'],
});

// Only genuine HTTP error statuses are honoured; anything else (undefined, 0, 200, 99999) is a 500.
export function statusFor(err) {
  const status = err?.status ?? err?.statusCode;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

// Express recognises error handlers by their four-argument signature.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const parserError = BODY_PARSER_ERRORS[err?.type];
  const status = parserError ? parserError[0] : statusFor(err);
  if (status >= 500) logger.error(err);

  let message;
  if (parserError) [, message] = parserError;
  else if (status >= 500 && config.isProduction) message = 'Internal server error';
  else message = typeof err?.message === 'string' && err.message ? err.message : 'Request failed';

  return res.status(status).json({ error: { message } });
}
