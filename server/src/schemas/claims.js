import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// One Zod definition drives: (1) the Claude extraction tool-schema,
// (2) runtime validation of the model's output, (3) the shape we persist.
export const EntityType = z.enum([
  'place', 'event', 'activity', 'product', 'media', 'person', 'other',
]);

export const Claim = z.object({
  entity_name: z.string().describe('Name of the place/event/product/etc. the claim is about'),
  entity_type: EntityType,
  attribute: z.string().describe('What is asserted, e.g. "recommended", "cuisine", "price", "date"'),
  value: z.string().describe('The value of the attribute'),
  location_hint: z.string().nullable().describe('City / area / address if mentioned, else null'),
  time_hint: z.string().nullable().describe('Raw date/time text if event-like, else null'),
  event_start: z.string().nullable().describe('Absolute event start as ISO 8601 (resolve relative dates using the provided current date); null if not an event or unknown'),
  event_end: z.string().nullable().describe('Absolute event end as ISO 8601, or null'),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  recommendation_strength: z.number().min(0).max(1).describe('0..1 how strongly the content recommends this'),
  category: z.string().nullable(),
});

export const Extraction = z.object({
  summary: z.string().describe('One sentence describing what the content is about'),
  claims: z.array(Claim),
});

// Inline all $defs so the Anthropic tool-schema validator is happy.
export const extractionJsonSchema = zodToJsonSchema(Extraction, { $refStrategy: 'none' });
