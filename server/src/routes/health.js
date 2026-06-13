import { pool } from '../db.js';
import { hasLLM } from '../llm/anthropic.js';
import { browserAvailable } from '../lib/browser.js';
import { config } from '../config.js';

export default async function healthRoutes(fastify) {
  fastify.get('/health', async (request, reply) => {
    let db = false;
    try {
      await pool.query('select 1');
      db = true;
    } catch {
      db = false;
    }
    if (!db) reply.code(503); // load balancers / readiness probes key on this
    return {
      ok: db,
      db,
      llm: hasLLM(),
      embeddings: config.voyageApiKey ? 'voyage' : 'hash-fallback',
      browser_fallback: config.browser.fallback && (await browserAvailable()),
    };
  });
}
