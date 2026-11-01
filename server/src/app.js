import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config/env.js';
import apiRoutes from './routes/index.js';
import { csrfProtection } from './middleware/csrfProtection.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { productionConfigProblems } from './config/validate.js';

export function createApp() {
  if (Buffer.byteLength(config.sessionSecret) < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 bytes before the API starts.');
  }
  if (config.isProduction) {
    const problems = productionConfigProblems(config);
    if (problems.length > 0) {
      throw new Error(`Refusing to start with unsafe production configuration:\n- ${problems.join('\n- ')}`);
    }
  }

  const app = express();

  app.disable('x-powered-by');
  // Behind a load balancer req.ip would be the balancer's address, collapsing every client into one
  // rate-limit bucket. Only trust forwarded headers when the operator says how many proxies exist.
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', csrfProtection);

  if (config.nodeEnv !== 'test') {
    app.use(morgan(config.isProduction ? 'combined' : 'dev'));
  }

  app.use('/api', apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
