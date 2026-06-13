import { pool } from '../db.js';
import { config } from '../config.js';

const rl = { config: { rateLimit: { max: config.rateLimit.max, timeWindow: config.rateLimit.windowMs } } };

// GDPR/CCPA: per-user data export and erasure. user_id comes from auth (req.userId).
export default async function meRoutes(fastify) {
  fastify.get('/v1/me/export', rl, async (req) => {
    const uid = req.userId || config.defaultUserId;
    const saves = await pool.query(
      `select s.id, s.permalink, s.platform, s.title, s.summary, us.saved_at, us.collection
       from user_save us join source s on s.id = us.source_id
       where us.user_id = $1 order by us.saved_at desc`,
      [uid],
    );
    const claims = await pool.query(
      `select c.attribute, c.value, c.sentiment, c.recommendation_strength, c.category, c.event_start, c.event_end,
              e.canonical_name as entity_name, e.type as entity_type, s.permalink
       from claim c
       join user_save us on us.source_id = c.source_id
       join source s on s.id = c.source_id
       left join entity e on e.id = c.entity_id
       where us.user_id = $1`,
      [uid],
    );
    return { user_id: uid, exported_at: new Date().toISOString(), saves: saves.rows, claims: claims.rows };
  });

  // Erasure: drop the user's saves, then delete now-orphaned sources (cascades
  // their claims). Sources still saved by others are retained (shared catalog).
  fastify.delete('/v1/me', rl, async (req) => {
    const uid = req.userId || config.defaultUserId;
    const del = await pool.query('delete from user_save where user_id=$1', [uid]);
    const orphans = await pool.query(
      `delete from source s where not exists (select 1 from user_save us where us.source_id = s.id) returning id`,
    );
    return { user_id: uid, deleted_saves: del.rowCount, deleted_orphan_sources: orphans.rowCount };
  });
}
