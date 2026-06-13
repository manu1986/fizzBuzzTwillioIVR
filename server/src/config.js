import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://curio:curio@localhost:5432/curio',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  voyageApiKey: process.env.VOYAGE_API_KEY || '',
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || '', // optional; Nominatim fallback otherwise
  defaultUserId: process.env.DEFAULT_USER_ID || 'dev-user',
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'UTC',
  embeddingDim: 1024,
  // Cost-tiered cascade (see plan §6.3). Phase 0 wires T0 + synthesis.
  models: {
    extract: 'claude-haiku-4-5',   // T0 extraction
    plan: 'claude-sonnet-4-6',     // query planner (fast, cheap, good enough)
    synthesize: 'claude-opus-4-8', // grounded answer synthesis
  },
};
