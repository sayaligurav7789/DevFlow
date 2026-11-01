import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { pool } from './pool.js';

const seedLockKey = 1401092;

export async function seedDatabase() {
  // The seed creates a placeholder owner and sample data. That is for local development only.
  if (config.isProduction && process.env.DEVFLOW_ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error('Refusing to seed a production database. Set DEVFLOW_ALLOW_PRODUCTION_SEED=true to override.');
  }
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [seedLockKey, 2]);
    lockAcquired = true;
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = NOW()
       RETURNING id`,
      [
        process.env.DEVFLOW_SEED_EMAIL || 'devflow-seed@local.test',
        process.env.DEVFLOW_SEED_NAME || 'DevFlow Local Seed',
      ],
    );
    const userId = userResult.rows[0].id;

    const workspaceResult = await client.query(
      `INSERT INTO workspaces (slug, name, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name, updated_at = NOW()
       RETURNING id`,
      ['devflow-local', 'DevFlow Local', userId],
    );
    const workspaceId = workspaceResult.rows[0].id;

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner'`,
      [workspaceId, userId],
    );

    const projectResult = await client.query(
      `INSERT INTO projects (workspace_id, slug, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, slug) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           updated_at = NOW()
       RETURNING id`,
      [
        workspaceId,
        'getting-started',
        'Getting Started',
        'A sample project created by the local seed script.',
        userId,
      ],
    );
    const projectId = projectResult.rows[0].id;

    await client.query(
      `INSERT INTO tasks (project_id, title, description, status, priority, created_by, reporter_id)
       SELECT $1, $2, $3, 'todo', 'medium', $4, $4
       WHERE NOT EXISTS (
         SELECT 1 FROM tasks WHERE project_id = $1 AND title = $2
       )`,
      [
        projectId,
        'Plan the next DevFlow milestone',
        'Replace this sample task with your first real project task.',
        userId,
      ],
    );

    await client.query('COMMIT');
    logger.info('Development seed data is ready');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [seedLockKey, 2]);
    }
    client.release();
  }
}

async function main() {
  try {
    await seedDatabase();
  } catch (error) {
    logger.error('Database seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
