import { pool } from './db.js';
import { processSource } from './pipeline/process.js';
import { logger } from './lib/logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Postgres-backed queue via FOR UPDATE SKIP LOCKED — no Redis needed for Phase 0.
async function claimNext() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query(
      `select id from source where status='queued' order by created_at limit 1 for update skip locked`,
    );
    let id = null;
    if (r.rows[0]) {
      id = r.rows[0].id;
      await client.query("update source set status='resolving', updated_at=now() where id=$1", [id]);
    }
    await client.query('commit');
    return id;
  } catch (e) {
    await client.query('rollback');
    logger.error('claim_failed', { err: String(e) });
    return null;
  } finally {
    client.release();
  }
}

logger.info('worker_started');
// eslint-disable-next-line no-constant-condition
while (true) {
  const id = await claimNext();
  if (id) await processSource(id);
  else await sleep(1000);
}
