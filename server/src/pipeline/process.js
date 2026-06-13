import { pool, withTx } from '../db.js';
import { resolveConnector } from '../sources/index.js';
import { extractClaims } from '../llm/anthropic.js';
import { embed } from '../llm/embeddings.js';
import { geocode } from '../llm/geocode.js';
import { normName, toVectorLiteral } from '../lib/text.js';
import { logger } from '../lib/logger.js';

// Orchestrates one source: resolve -> extract -> entity-resolve(+geocode) -> persist.
// Each stage degrades gracefully so a save never hard-fails.
export async function processSource(sourceId) {
  const { rows } = await pool.query('select * from source where id=$1', [sourceId]);
  const src = rows[0];
  if (!src) return;

  try {
    await pool.query("update source set status='resolving', updated_at=now() where id=$1", [sourceId]);

    const connector = resolveConnector(src.permalink);
    const resolution = await connector.resolve(src.permalink);

    let extraction = null;
    let costUsd = 0;
    let tier = 'heuristic';
    const llm = await extractClaims({
      text: resolution.text,
      sourceMeta: {
        title: resolution.title,
        author: resolution.author,
        platform: resolution.platform,
        permalink: resolution.permalink,
        description: resolution.description,
        current_date: new Date().toISOString(),
      },
    });
    if (llm) {
      extraction = llm.extraction;
      costUsd = llm.costUsd;
      tier = `T0:${llm.model}`;
    } else {
      extraction = heuristicExtraction(resolution);
    }

    await persist({ src, resolution, extraction, costUsd, tier });
    logger.info('processed', { sourceId, claims: extraction.claims.length, tier });
  } catch (e) {
    logger.error('process_failed', { sourceId, err: String(e) });
    await pool.query("update source set status='error', error=$2, updated_at=now() where id=$1", [
      sourceId,
      String(e).slice(0, 500),
    ]);
  }
}

function heuristicExtraction(r) {
  const claims = [];
  if (r.title) {
    claims.push({
      entity_name: r.title.slice(0, 120),
      entity_type: 'other',
      attribute: 'title',
      value: r.title,
      location_hint: null,
      time_hint: null,
      event_start: null,
      event_end: null,
      sentiment: 'neutral',
      recommendation_strength: 0.3,
      category: null,
    });
  }
  return { summary: r.description || r.title || 'Saved content', claims };
}

function safeDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function persist({ src, resolution, extraction, costUsd, tier }) {
  // Network work (embeddings + geocoding) happens outside the transaction.
  // Geocode once per unique place/event entity, cached within this item.
  const geoCache = new Map();
  const prepared = [];
  for (const c of extraction.claims) {
    const emb = await embed(`${c.entity_name} ${c.attribute}: ${c.value} ${c.location_hint || ''}`);
    let geo = null;
    if (c.entity_type === 'place' || c.entity_type === 'event') {
      const key = `${c.entity_type}|${normName(c.entity_name)}`;
      if (geoCache.has(key)) geo = geoCache.get(key);
      else {
        geo = await geocode([c.entity_name, c.location_hint].filter(Boolean).join(', '));
        geoCache.set(key, geo);
      }
    }
    prepared.push({ c, vec: toVectorLiteral(emb), geo, eventStart: safeDate(c.event_start), eventEnd: safeDate(c.event_end) });
  }

  await withTx(async (client) => {
    await client.query(
      `update source set platform=$2, title=$3, author=$4, description=$5, thumbnail=$6,
         resolved=$7, summary=$8, status='done', tier=$9, cost_usd=cost_usd+$10, error=null, updated_at=now()
       where id=$1`,
      [
        src.id,
        resolution.platform,
        resolution.title,
        resolution.author,
        resolution.description,
        resolution.thumbnail,
        JSON.stringify(resolution),
        extraction.summary,
        tier,
        costUsd,
      ],
    );

    await client.query('delete from claim where source_id=$1', [src.id]);

    for (const { c, vec, geo, eventStart, eventEnd } of prepared) {
      const ent = await client.query(
        `insert into entity(type, canonical_name, norm_name, location_hint, lat, lng)
         values($1,$2,$3,$4,$5,$6)
         on conflict (norm_name, type) do update set
           canonical_name = excluded.canonical_name,
           location_hint  = coalesce(entity.location_hint, excluded.location_hint),
           lat            = coalesce(entity.lat, excluded.lat),
           lng            = coalesce(entity.lng, excluded.lng)
         returning id`,
        [c.entity_type, c.entity_name, normName(c.entity_name), c.location_hint, geo?.lat ?? null, geo?.lng ?? null],
      );
      const entityId = ent.rows[0].id;
      await client.query(
        `insert into claim(source_id, entity_id, attribute, value, sentiment, recommendation_strength,
                           category, time_hint, event_start, event_end, embedding)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector)`,
        [src.id, entityId, c.attribute, c.value, c.sentiment, c.recommendation_strength, c.category, c.time_hint, eventStart, eventEnd, vec],
      );
    }
  });
}
