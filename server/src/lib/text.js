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
