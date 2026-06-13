import { pool } from '../db.js';
import { hasLLM } from '../llm/anthropic.js';
import { config } from '../config.js';

export default async function healthRoutes(fastify) {
  fastify.get('/health', async () => {
    let db = false;
    try {
      await pool.query('select 1');
      db = true;
    } catch {
      db = false;
    }
    return {
      ok: db,
      db,
      llm: hasLLM(),
      embeddings: config.voyageApiKey ? 'voyage' : 'hash-fallback',
    };
  });
}
