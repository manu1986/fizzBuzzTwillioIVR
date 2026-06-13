import { config } from '../config.js';
import { answerQuery } from '../query/answer.js';

export default async function queryRoutes(fastify) {
  fastify.post('/v1/query', {
    schema: {
      summary: 'Ask a natural-language question over saved content',
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          scope: { type: 'string', enum: ['mine', 'all'], default: 'mine' },
          tz: { type: 'string', description: 'IANA timezone for resolving relative dates' },
        },
      },
    },
    config: { rateLimit: { max: config.rateLimit.max, timeWindow: config.rateLimit.windowMs } },
  }, async (req, reply) => {
    const { text, scope, tz } = req.body || {};
    if (!text) return reply.code(400).send({ error: 'text required' });
    return answerQuery({
      question: text,
      userId: req.userId || config.defaultUserId, // from auth, never trust body
      scope: scope || 'mine',
      tz: tz || config.defaultTimezone,
    });
  });
}
