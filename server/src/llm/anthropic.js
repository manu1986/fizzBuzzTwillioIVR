import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { extractionJsonSchema, Extraction } from '../schemas/claims.js';
import { logger } from '../lib/logger.js';

const client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
export const hasLLM = () => !!client;

const PRICES = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-opus-4-8': { in: 5, out: 25 },
};
function costOf(model, usage) {
  const p = PRICES[model] || { in: 0, out: 0 };
  return (usage.input_tokens / 1e6) * p.in + (usage.output_tokens / 1e6) * p.out;
}

// T0 extraction. Forces a structured tool call so we always get valid JSON.
// Returns { extraction, costUsd, model } or null (caller falls back to heuristic).
export async function extractClaims({ text, sourceMeta }) {
  if (!client) return null;
  const system =
    'You extract structured, factual claims from short-form social/web content. ' +
    'Assert only what the content supports. Resolve obvious entity names. ' +
    'Use null when a field is unknown. Keep claims atomic.';
  const userText =
    `SOURCE METADATA:\n${JSON.stringify(sourceMeta)}\n\nCONTENT:\n${(text || '').slice(0, 8000)}`;
  try {
    const msg = await client.messages.create({
      model: config.models.extract,
      max_tokens: 2000,
      system,
      tools: [
        {
          name: 'emit_extraction',
          description: 'Return the structured extraction of claims.',
          input_schema: extractionJsonSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_extraction' },
      messages: [{ role: 'user', content: userText }],
    });
    const block = msg.content.find((b) => b.type === 'tool_use');
    if (!block) return null;
    const parsed = Extraction.safeParse(block.input);
    if (!parsed.success) {
      logger.warn('extraction_invalid', { issues: parsed.error.issues?.slice(0, 3) });
      return null;
    }
    return { extraction: parsed.data, costUsd: costOf(config.models.extract, msg.usage), model: config.models.extract };
  } catch (e) {
    logger.error('extraction_failed', { err: String(e) });
    return null;
  }
}

// Grounded, cited synthesis over retrieved claims (plan §6.7 step 4).
export async function synthesizeAnswer({ question, claims }) {
  if (!client) return { text: fallbackAnswer(question, claims), model: 'fallback', costUsd: 0 };
  const context = claims
    .map((c, i) => `[${i + 1}] ${c.entity_name || 'item'} — ${c.attribute}: ${c.value} (src: ${c.permalink || c.source_id})`)
    .join('\n');
  const system =
    'Answer ONLY from the provided claims. Cite sources inline as [n]. ' +
    "If the claims don't contain the answer, say so plainly. Never invent facts.";
  try {
    const msg = await client.messages.create({
      model: config.models.synthesize,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: `Question: ${question}\n\nClaims:\n${context || '(none)'}` }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, model: config.models.synthesize, costUsd: costOf(config.models.synthesize, msg.usage) };
  } catch (e) {
    logger.error('synthesis_failed', { err: String(e) });
    return { text: fallbackAnswer(question, claims), model: 'fallback', costUsd: 0 };
  }
}

function fallbackAnswer(question, claims) {
  if (!claims.length) return `No saved content matches "${question}" yet.`;
  const lines = claims
    .slice(0, 8)
    .map((c, i) => `[${i + 1}] ${c.entity_name || 'item'} — ${c.attribute}: ${c.value}`);
  return `Top matches from your saves (LLM synthesis disabled — set ANTHROPIC_API_KEY for grounded answers):\n${lines.join('\n')}`;
}
