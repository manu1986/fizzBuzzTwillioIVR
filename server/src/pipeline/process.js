import { pool, withTx } from '../db.js';
import { resolveConnector } from '../sources/index.js';
import { extractClaims } from '../llm/anthropic.js';
import { embed } from '../llm/embeddings.js';
import { normName, toVectorLiteral } from '../lib/text.js';
import { logger } from '../lib/logger.js';

// Orchestrates one source through resolve -> extract -> (entity-resolve) -> persist.
// Each stage degrades gracefully so a save never hard-fails.
export async function processSource(sourceId) {
  const { rows } = await pool.query('select * from source where id=$1', [sourceId]);
  const src = rows[0];
  if (!src) return;

  try {
    await pool.query("update source set status='resolving', updated_at=now() where id=$1", [sourceId]);

    const connector = resolveConnector(src.permalink);
    const resolution = await connector.resolve(src.permalink);

    // T0 extraction; fall back to a heuristic when the LLM is unavailable.
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
      sentiment: 'neutral',
      recommendation_strength: 0.3,
      category: null,
    });
  }
  return { summary: r.description || r.title || 'Saved content', claims };
}

async function persist({ src, resolution, extraction, costUsd, tier }) {
  // Pre-compute embeddings outside the transaction (network calls).
  const prepared = [];
  for (const c of extraction.claims) {
    const emb = await embed(`${c.entity_name} ${c.attribute}: ${c.value} ${c.location_hint || ''}`);
    prepared.push({ c, vec: toVectorLiteral(emb) });
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

    // Idempotent reprocess: replace prior claims for this source.
    await client.query('delete from claim where source_id=$1', [src.id]);

    for (const { c, vec } of prepared) {
      // v0 entity resolution: dedupe by (normalized name, type). Real ER anchors on geo + embeddings (plan §6.5).
      const ent = await client.query(
        `insert into entity(type, canonical_name, norm_name, location_hint)
         values($1,$2,$3,$4)
         on conflict (norm_name, type) do update set canonical_name = excluded.canonical_name
         returning id`,
        [c.entity_type, c.entity_name, normName(c.entity_name), c.location_hint],
      );
      const entityId = ent.rows[0].id;
      await client.query(
        `insert into claim(source_id, entity_id, attribute, value, sentiment, recommendation_strength, category, time_hint, embedding)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)`,
        [src.id, entityId, c.attribute, c.value, c.sentiment, c.recommendation_strength, c.category, c.time_hint, vec],
      );
    }
  });
}
