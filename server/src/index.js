import { config } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { closeRedis, startRedis } from './lib/redis.js';
import { pool } from './db/pool.js';
import { startDeadlineScheduler, stopDeadlineScheduler } from './jobs/deadlineScheduler.js';
import { startIntegrationOutbox, stopIntegrationOutbox } from './jobs/integrationOutbox.js';

const app = createApp();
startRedis();

const server = app.listen(config.port, () => {
  logger.info(`DevFlow server listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

startDeadlineScheduler();
startIntegrationOutbox(config.notifications.integrationOutboxIntervalMs);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${config.port} is already in use. Set a different PORT in server/.env.`);
  } else {
    logger.error(err);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  stopDeadlineScheduler();
  stopIntegrationOutbox();
  // Orchestrators send SIGKILL after a grace period (10 s for `docker stop`). Finish first if we
  // can, but never hang on idle keep-alive connections.
  const force = setTimeout(() => {
    logger.error('Graceful shutdown timed out; exiting');
    process.exit(1);
  }, 8000);
  force.unref();
  server.close(async () => {
    try {
      await closeRedis();
      await pool.end();
    } catch (error) {
      logger.error('Error during shutdown:', error.message);
    }
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason instanceof Error ? reason : String(reason));
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception, exiting:', error);
  process.exit(1);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
