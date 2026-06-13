import { pool } from '../db.js';

// ER health metrics (plan §6.5): watch these for graph rot — a spike in orphans
// or a collapse/explosion in merge rate is an early warning.
export default async function metricsRoutes(fastify) {
  fastify.get('/v1/metrics/er', async () => {
    const { rows } = await pool.query(`
      select
        (select count(*) from entity) as entities,
        (select count(*) from entity where place_id is not null) as with_place_id,
        (select count(*) from entity where coalesce(array_length(aliases,1),0) > 1) as merged_entities,
        (select count(*) from entity e where not exists (select 1 from claim c where c.entity_id = e.id)) as orphans,
        (select count(*) from claim) as claims,
        (select count(distinct entity_id) from claim) as entities_with_claims
    `);
    const r = rows[0];
    const entities = Number(r.entities) || 0;
    return {
      entities,
      claims: Number(r.claims),
      with_place_id: Number(r.with_place_id),
      with_place_id_pct: entities ? Number(r.with_place_id) / entities : 0,
      merged_entities: Number(r.merged_entities),
      merge_rate: entities ? Number(r.merged_entities) / entities : 0,
      orphans: Number(r.orphans),
      orphan_rate: entities ? Number(r.orphans) / entities : 0,
      avg_claims_per_entity: Number(r.entities_with_claims) ? Number(r.claims) / Number(r.entities_with_claims) : 0,
    };
  });
}
