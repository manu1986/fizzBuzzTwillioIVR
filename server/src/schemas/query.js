import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// The query planner's output — routes a NL question to retrieval primitives
// (plan §6.9). One Zod schema drives the Claude tool-schema + validation.
export const QueryPlan = z.object({
  mode: z.enum(['lookup', 'filter', 'rank', 'compare']),
  search_text: z.string().describe('Core thing to semantically search for'),
  entity_type: z.enum(['place', 'event', 'activity', 'product', 'media', 'person', 'any']),
  location: z.string().nullable().describe('Place name to geocode if geographically scoped, else null'),
  radius_km: z.number().nullable(),
  time_relative: z.string().nullable().describe("Relative phrase like 'this weekend','today','saturday', else null"),
  time_start: z.string().nullable().describe('Absolute ISO start if the user gave explicit dates, else null'),
  time_end: z.string().nullable(),
  category: z.string().nullable(),
  ranking: z.enum(['relevance', 'best', 'recent']),
  limit: z.number().int().min(1).max(50),
});

export const queryPlanJsonSchema = zodToJsonSchema(QueryPlan, { $refStrategy: 'none' });
