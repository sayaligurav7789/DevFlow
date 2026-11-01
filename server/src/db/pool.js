import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'devflow-server',
});

pool.on('error', (error) => {
  logger.error('Unexpected idle PostgreSQL client error:', error.message);
});

export async function checkDatabaseConnection() {
  await pool.query('SELECT 1');
  return true;
}
