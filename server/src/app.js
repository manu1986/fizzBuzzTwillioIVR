import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import { authHook } from './plugins/auth.js';
import itemsRoutes from './routes/items.js';
import queryRoutes from './routes/query.js';
import healthRoutes from './routes/health.js';
import metricsRoutes from './routes/metrics.js';
import meRoutes from './routes/me.js';

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Curio API', description: 'Share-to-knowledge-graph backend', version: '0.0.1' },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Auth resolves req.userId before rate-limit keys on it. Registered first so
  // its onRequest hook runs before the rate-limit plugin's.
  app.addHook('onRequest', authHook());
  await app.register(rateLimit, { global: false, keyGenerator: (req) => req.userId || req.ip });

  await app.register(healthRoutes);
  await app.register(itemsRoutes);
  await app.register(queryRoutes);
  await app.register(metricsRoutes);
  await app.register(meRoutes);

  return app;
}
