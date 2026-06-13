import { normName } from '../lib/text.js';

export function jaccard(a, b) {
  const A = new Set(normName(a).split(' ').filter(Boolean));
  const B = new Set(normName(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// Fuzzy entity name match used for SCORING (deliberately more lenient than the
// pipeline's exact-key ER, so extraction quality isn't masked by ER strictness).
export function entityMatch(a, b) {
  return normName(a) === normName(b) || jaccard(a, b) >= 0.6;
}

// Precision/Recall/F1 of extracted entities vs expected (greedy 1:1 matching).
export function scoreEntities(extracted, expected) {
  const used = new Set();
  let matched = 0;
  const misses = [];
  for (const exp of expected) {
    let hit = false;
    for (let i = 0; i < extracted.length; i += 1) {
      if (used.has(i)) continue;
      if (entityMatch(exp.name, extracted[i].name)) { used.add(i); hit = true; break; }
    }
    if (hit) matched += 1;
    else misses.push(exp.name);
  }
  const precision = extracted.length ? used.size / extracted.length : 0;
  const recall = expected.length ? matched / expected.length : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, matched, expected: expected.length, extracted: extracted.length, misses };
}

// The pipeline's actual ER key (must mirror process.js persist logic).
export function erKey(name, type) {
  return `${type}|${normName(name)}`;
}

// Measure the current ER keying against labeled merge/split cases.
export function scoreEr({ same = [], different = [] }) {
  let correct = 0;
  let total = 0;
  const errors = [];
  for (const [a, b] of same) {
    total += 1;
    if (erKey(a.name, a.type) === erKey(b.name, b.type)) correct += 1;
    else errors.push({ kind: 'should-merge-but-split', a: a.name, b: b.name });
  }
  for (const [a, b] of different) {
    total += 1;
    if (erKey(a.name, a.type) !== erKey(b.name, b.type)) correct += 1;
    else errors.push({ kind: 'should-split-but-merged', a: a.name, b: b.name });
  }
  return { accuracy: total ? correct / total : 0, correct, total, errors };
}
