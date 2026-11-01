import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../db/migrations',
);
const migrationFilePattern = /^\d{3,}_[a-z0-9_]+\.sql$/;
const migrationLockKey = 1401092;

export async function runMigrations(directory = migrationsDirectory) {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [migrationLockKey, 1]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationNames = (await readdir(directory))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const name of migrationNames) {
      if (!migrationFilePattern.test(name)) {
        throw new Error(`Invalid migration filename: ${name}`);
      }

      const sql = await readFile(path.join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [name],
      );

      if (existing.rowCount > 0) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration was modified: ${name}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await client.query('COMMIT');
        logger.info(`Applied migration ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed and was rolled back`, { cause: error });
      }
    }

    logger.info('Database migrations are up to date');
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [migrationLockKey, 1]);
    }
    client.release();
  }
}

async function main() {
  try {
    await runMigrations();
  } catch (error) {
    logger.error('Migration run failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
