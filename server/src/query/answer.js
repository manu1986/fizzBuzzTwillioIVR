import { planQuery, synthesizeAnswer } from '../llm/anthropic.js';
import { executePlan } from './retrieval.js';

// Orchestrates the query path (plan §6.9): plan -> retrieve -> grounded synthesis.
// Falls back to a plain semantic lookup if the planner is unavailable.
export async function answerQuery({ question, userId, scope = 'mine', tz = 'UTC' }) {
  const now = new Date();
  const plan = (await planQuery({ question, now, tz })) || fallbackPlan(question);
  const { rows, resolved } = await executePlan({ plan, userId, scope, now });
  const synth = await synthesizeAnswer({ question, claims: rows });

  return {
    answer: synth.text,
    model: synth.model,
    plan,
    resolved,
    citations: dedupeCitations(rows),
    results: rows,
  };
}

function fallbackPlan(question) {
  return {
    mode: 'lookup',
    search_text: question,
    entity_type: 'any',
    location: null,
    radius_km: null,
    time_relative: null,
    time_start: null,
    time_end: null,
    category: null,
    ranking: 'relevance',
    limit: 12,
  };
}

function dedupeCitations(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const links = r.sources?.length ? r.sources : [r.permalink].filter(Boolean);
    for (const link of links) {
      if (!link || seen.has(link)) continue;
      seen.add(link);
      out.push({ n: out.length + 1, permalink: link });
    }
  }
  return out;
}
