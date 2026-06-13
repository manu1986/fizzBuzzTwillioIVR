// Naive normalization used as a v0 entity-resolution key.
// Real ER (plan §6.5) anchors on a Places API + embeddings + LLM disambiguation.
export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function toVectorLiteral(arr) {
  return '[' + arr.map((x) => (Number.isFinite(x) ? x : 0)).join(',') + ']';
}
