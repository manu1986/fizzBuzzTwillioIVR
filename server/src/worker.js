import { pool } from './db.js';
import { processSource } from './pipeline/process.js';
import { logger } from './lib/logger.js';
import { migrate } from './db/migrate.js';
import { closeBrowser } from './lib/browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = true;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    logger.info('worker_draining', { sig });
    running = false;
  });
}

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

await migrate();
logger.info('worker_started');
while (running) {
  const id = await claimNext();
  if (id) await processSource(id);
  else await sleep(1000);
}
await closeBrowser();
await pool.end();
logger.info('worker_stopped');
process.exit(0);
