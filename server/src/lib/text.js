// Naive normalization used as a v0 entity-resolution key.
// Real ER (plan §6.5) anchors on a Places API + embeddings + LLM disambiguation.
export function normName(s) {
  const cleaned = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, ''); // leading articles are noise, not identity
  return cleaned.slice(0, 200);
}

export function toVectorLiteral(arr) {
  return '[' + arr.map((x) => (Number.isFinite(x) ? x : 0)).join(',') + ']';
}

// Character-trigram set (space-padded) of a normalized name.
export function trigrams(s) {
  const t = ` ${normName(s)} `;
  const out = new Set();
  for (let i = 0; i < t.length - 2; i += 1) out.add(t.slice(i, i + 3));
  return out;
}

// Dice coefficient over trigrams — fuzzy name similarity in [0,1]. Mirrors the
// pipeline's pg_trgm similarity so JS-side and DB-side ER agree.
export function nameSimilarity(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}
