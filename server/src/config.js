import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://curio:curio@localhost:5432/curio',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  voyageApiKey: process.env.VOYAGE_API_KEY || '',
  defaultUserId: process.env.DEFAULT_USER_ID || 'dev-user',
  embeddingDim: 1024,
  // Cost-tiered cascade (see plan §6.3). Phase 0 wires T0 + synthesis.
  models: {
    extract: 'claude-haiku-4-5',   // T0
    synthesize: 'claude-opus-4-8', // query answering
  },
};
