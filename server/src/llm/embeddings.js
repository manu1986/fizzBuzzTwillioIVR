import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

// Pluggable Embedder. Voyage when a key is present; deterministic hash fallback
// otherwise so the pipeline runs end-to-end without external keys.
export async function embed(text) {
  if (config.voyageApiKey) {
    try {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.voyageApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'voyage-3', input: [String(text).slice(0, 8000)] }),
      });
      if (res.ok) {
        const j = await res.json();
        return j.data[0].embedding;
      }
      logger.warn('voyage_non_ok', { status: res.status });
    } catch (e) {
      logger.warn('voyage_failed', { err: String(e) });
    }
  }
  return hashEmbed(text, config.embeddingDim);
}

// NOT semantically meaningful — a stand-in so vectors exist and SQL works.
function hashEmbed(text, dim) {
  const v = new Array(dim).fill(0);
  const toks = String(text).toLowerCase().split(/\W+/).filter(Boolean);
  for (const t of toks) {
    const h = crypto.createHash('md5').update(t).digest();
    for (let i = 0; i < dim; i++) v[i] += h[i % 16] / 255 - 0.5;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
