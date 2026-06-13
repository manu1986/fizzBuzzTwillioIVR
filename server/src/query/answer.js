import { pool } from '../db.js';
import { embed } from '../llm/embeddings.js';
import { synthesizeAnswer } from '../llm/anthropic.js';
import { toVectorLiteral } from '../lib/text.js';

// Phase 0 query path: semantic retrieval over claims + grounded synthesis.
// The agentic planner / structured + aggregate tools (plan §6.9) slot in here.
export async function answerQuery({ question, userId, scope = 'mine', k = 12 }) {
  const vec = toVectorLiteral(await embed(question));
  const params = [vec];
  let userJoin = '';
  if (scope === 'mine' && userId) {
    params.push(userId);
    userJoin = `join user_save us on us.source_id = s.id and us.user_id = $2`;
  }

  const sql = `
    select c.id, c.attribute, c.value, c.sentiment, c.recommendation_strength, c.time_hint,
           e.canonical_name as entity_name, e.type as entity_type, e.location_hint,
           s.id as source_id, s.permalink, s.title as source_title,
           1 - (c.embedding <=> $1::vector) as score
    from claim c
    join source s on s.id = c.source_id
    ${userJoin}
    left join entity e on e.id = c.entity_id
    order by c.embedding <=> $1::vector
    limit ${Number(k)}`;

  const { rows } = await pool.query(sql, params);
  const synth = await synthesizeAnswer({ question, claims: rows });

  const citations = rows.map((r, i) => ({
    n: i + 1,
    source_id: r.source_id,
    permalink: r.permalink,
    title: r.source_title,
  }));

  return { answer: synth.text, model: synth.model, results: rows, citations };
}
