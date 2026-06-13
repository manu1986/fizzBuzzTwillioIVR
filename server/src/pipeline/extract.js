import { config } from '../config.js';
import { extractClaims } from '../llm/anthropic.js';

// Confidence/coverage score for an extraction in [0,1]. Heuristic, explainable:
// did we get claims, are there enough relative to the content, and are they
// specific (have a value + location/category/time)?
export function scoreExtraction(extraction, text = '') {
  const claims = extraction?.claims || [];
  if (claims.length === 0) return 0;
  const expected = Math.max(1, Math.min(8, Math.round((text.length || 0) / 400)));
  const coverage = Math.min(1, claims.length / expected);
  let rich = 0;
  for (const c of claims) {
    const specific = c.location_hint || c.category || c.time_hint ? 1 : 0;
    const hasValue = c.value && String(c.value).length > 3 ? 1 : 0;
    rich += 0.5 * specific + 0.5 * hasValue;
  }
  const richness = rich / claims.length;
  return 0.6 * coverage + 0.4 * richness;
}

function shortModel(model) {
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  return model;
}

// Run the tiered cascade: start at `startIndex`, escalate to the next model
// while confidence < threshold, keep the best-scoring result. Returns
// { extraction, costUsd, model, tier, score, trail } or null.
export async function extractCascade({ text, sourceMeta, startIndex = 0, threshold, maxTierIndex } = {}) {
  const { tiers } = config.extraction;
  const thr = threshold ?? config.extraction.confidenceThreshold;
  const maxIdx = Math.min(maxTierIndex ?? config.extraction.maxTier, tiers.length - 1);

  let best = null;
  let totalCost = 0;
  const trail = [];
  for (let i = startIndex; i <= maxIdx; i += 1) {
    const model = tiers[i];
    const r = await extractClaims({ text, sourceMeta, model });
    if (!r) {
      trail.push({ tier: i, model, ok: false });
      continue;
    }
    totalCost += r.costUsd;
    const score = scoreExtraction(r.extraction, text);
    trail.push({ tier: i, model, score: Number(score.toFixed(3)), claims: r.extraction.claims.length });
    if (!best || score > best.score) best = { ...r, score, tierIndex: i };
    if (score >= thr) break; // good enough — don't pay for a higher tier
  }
  if (!best) return null;
  return {
    extraction: best.extraction,
    costUsd: totalCost,
    model: best.model,
    tier: `T${best.tierIndex}:${shortModel(best.model)}`,
    score: best.score,
    trail,
  };
}
