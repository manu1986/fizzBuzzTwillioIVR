import { pool } from '../db.js';
import { fingerprint, normalizeUrl } from '../lib/fingerprint.js';
import { config } from '../config.js';
import { processSource } from '../pipeline/process.js';

export default async function itemsRoutes(fastify) {
  // Submit a shared URL. Idempotent on content fingerprint (dedup short-circuit).
  fastify.post('/v1/items', {
    schema: {
      summary: 'Submit a shared URL for ingestion',
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          user_id: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: { sync: { type: 'string', description: 'set "true" to process inline (debug)' } },
      },
    },
  }, async (req, reply) => {
    const { url, user_id: userId } = req.body || {};
    if (!url) return reply.code(400).send({ error: 'url required' });
    const uid = userId || config.defaultUserId;
    const fp = fingerprint(url);

    // Re-queue items stuck in 'error' so a transient failure isn't terminal;
    // leave 'done' untouched (pure fan-out / dedup short-circuit).
    const ins = await pool.query(
      `insert into source(fingerprint, permalink, status) values($1,$2,'queued')
       on conflict (fingerprint) do update set
         updated_at = now(),
         status = case when source.status = 'error' then 'queued' else source.status end
       returning id, status`,
      [fp, normalizeUrl(url)],
    );
    const sourceId = ins.rows[0].id;
    const priorStatus = ins.rows[0].status; // 'done' => already processed (pure fan-out)

    await pool.query(
      `insert into user_save(user_id, source_id) values($1,$2) on conflict do nothing`,
      [uid, sourceId],
    );

    if (priorStatus !== 'done' && req.query.sync === 'true') {
      await processSource(sourceId);
    }

    const cur = await pool.query('select status from source where id=$1', [sourceId]);
    return {
      item_id: sourceId,
      fingerprint: fp,
      status: cur.rows[0].status,
      deduped: priorStatus === 'done',
    };
  });

  // Full trace for one item — the core refinement tool (plan §6.8).
  fastify.get('/v1/items/:id', async (req, reply) => {
    const { id } = req.params;
    const s = await pool.query('select * from source where id=$1', [id]);
    if (!s.rows[0]) return reply.code(404).send({ error: 'not found' });
    const claims = await pool.query(
      `select c.attribute, c.value, c.sentiment, c.recommendation_strength, c.category, c.time_hint,
              e.canonical_name as entity_name, e.type as entity_type, e.location_hint
       from claim c left join entity e on e.id = c.entity_id
       where c.source_id = $1 order by c.recommendation_strength desc nulls last`,
      [id],
    );
    const src = s.rows[0];
    return {
      source: {
        id: src.id, platform: src.platform, permalink: src.permalink, title: src.title,
        author: src.author, summary: src.summary, thumbnail: src.thumbnail,
      },
      claims: claims.rows,
      trace: { status: src.status, tier: src.tier, cost_usd: Number(src.cost_usd), error: src.error },
    };
  });
}
