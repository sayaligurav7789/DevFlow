import { getHealthStatus } from '../services/health.service.js';
import { checkDatabaseConnection } from '../db/pool.js';
import { logger } from '../utils/logger.js';

export async function getHealth(req, res) {
  const health = getHealthStatus();

  try {
    await checkDatabaseConnection();
    res.status(200).json({
      ...health,
      database: { status: 'ok' },
    });
  } catch (error) {
    logger.warn('PostgreSQL health check failed:', error.message);
    res.status(503).json({
      ...health,
      status: 'error',
      message: 'DevFlow backend is running but PostgreSQL is unavailable',
      database: { status: 'unavailable' },
    });
  }
}
