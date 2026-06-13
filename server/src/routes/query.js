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
          user_id: { type: 'string' },
          scope: { type: 'string', enum: ['mine', 'all'], default: 'mine' },
        },
      },
    },
  }, async (req, reply) => {
    const { text, user_id: userId, scope } = req.body || {};
    if (!text) return reply.code(400).send({ error: 'text required' });
    return answerQuery({ question: text, userId: userId || config.defaultUserId, scope: scope || 'mine' });
  });
}
