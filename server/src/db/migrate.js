import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../db.js';
import { logger } from '../lib/logger.js';

// schema.sql is written to be idempotent (IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS), so applying it on every boot is a safe, dependency-free migration.
export async function migrate() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, '..', '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  logger.info('schema_applied');
}
