import { pool } from '../db.js';
import { embed } from '../llm/embeddings.js';
import { geocode } from '../llm/geocode.js';
import { resolveRelative } from '../lib/datetime.js';
import { toVectorLiteral } from '../lib/text.js';

const EARTH_KM = 6371;

function safeDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Execute a QueryPlan against the store using the right primitive(s):
// structured geo/time/category filters + semantic OR aggregate ranking.
// All user-influenced values are bound parameters (no string interpolation).
export async function executePlan({ plan, userId, scope = 'mine', now = new Date() }) {
  // Resolve geo + time filters.
  let geo = null;
  let radius = null;
  if (plan.location) {
    const g = await geocode(plan.location);
    if (g) { geo = g; radius = plan.radius_km || 25; }
  }
  let timeRange = null;
  const ts = safeDate(plan.time_start);
  const te = safeDate(plan.time_end);
  if (ts || te) {
    timeRange = { start: ts || new Date(0), end: te || new Date('2100-01-01T00:00:00Z') };
  } else if (plan.time_relative) {
    timeRange = resolveRelative(plan.time_relative, now);
  }

  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  let joinUser = '';
  if (scope === 'mine' && userId) joinUser = `join user_save us on us.source_id = s.id and us.user_id = ${p(userId)}`;

  const where = [];
  if (plan.entity_type && plan.entity_type !== 'any') where.push(`e.type = ${p(plan.entity_type)}`);
  if (plan.category) where.push(`c.category ilike ${p('%' + plan.category + '%')}`);
  if (geo) {
    const lat = p(geo.lat);
    const lng = p(geo.lng);
    where.push(
      `e.lat is not null and (${EARTH_KM} * acos(least(1, greatest(-1, ` +
        `cos(radians(${lat})) * cos(radians(e.lat)) * cos(radians(e.lng) - radians(${lng})) + ` +
        `sin(radians(${lat})) * sin(radians(e.lat)))))) <= ${p(radius)}`,
    );
  }
  if (timeRange) {
    where.push(
      `c.event_start is not null and c.event_start <= ${p(timeRange.end)} and ` +
        `coalesce(c.event_end, c.event_start) >= ${p(timeRange.start)}`,
    );
  }
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const resolved = { location: geo ? { ...geo, radius_km: radius } : null, time: timeRange };

  // Aggregate ("best"/rank): group by canonical entity, rank by support x strength.
  if (plan.ranking === 'best' || plan.mode === 'rank') {
    const sql = `
      select e.id as entity_id, e.canonical_name as entity_name, e.type as entity_type, e.location_hint, e.lat, e.lng,
             count(distinct c.source_id)::int as support,
             avg(c.recommendation_strength) as avg_rec,
             max(s.created_at) as recency,
             (array_agg(distinct s.permalink))[1:3] as sources
      from claim c
      join source s on s.id = c.source_id
      ${joinUser}
      join entity e on e.id = c.entity_id
      ${whereSql}
      group by e.id
      order by (count(distinct c.source_id) * coalesce(avg(c.recommendation_strength), 0.5)) desc, max(s.created_at) desc
      limit ${p(plan.limit)}`;
    const { rows } = await pool.query(sql, params);
    return {
      resolved,
      rows: rows.map((r) => ({
        aggregate: true,
        entity_name: r.entity_name,
        entity_type: r.entity_type,
        location_hint: r.location_hint,
        attribute: 'recommended',
        value: `${r.support} source(s), avg strength ${Number(r.avg_rec ?? 0).toFixed(2)}`,
        support: r.support,
        avg_rec: r.avg_rec,
        permalink: r.sources?.[0] || null,
        sources: r.sources || [],
      })),
    };
  }

  // Per-claim retrieval. relevance => semantic order; recent => by recency.
  let orderSql;
  let scoreSel;
  if (plan.ranking === 'recent') {
    orderSql = 'order by s.created_at desc';
    scoreSel = 'extract(epoch from s.created_at) as score';
  } else {
    const vecRef = p(toVectorLiteral(await embed(plan.search_text)));
    orderSql = `order by c.embedding <=> ${vecRef}::vector`;
    scoreSel = `1 - (c.embedding <=> ${vecRef}::vector) as score`;
  }

  const sql = `
    select c.attribute, c.value, c.sentiment, c.recommendation_strength, c.time_hint, c.event_start, c.event_end,
           e.canonical_name as entity_name, e.type as entity_type, e.location_hint,
           s.id as source_id, s.permalink, s.title as source_title,
           ${scoreSel}
    from claim c
    join source s on s.id = c.source_id
    ${joinUser}
    left join entity e on e.id = c.entity_id
    ${whereSql}
    ${orderSql}
    limit ${p(plan.limit)}`;
  const { rows } = await pool.query(sql, params);
  return { resolved, rows };
}
