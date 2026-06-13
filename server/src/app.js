import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import itemsRoutes from './routes/items.js';
import queryRoutes from './routes/query.js';
import healthRoutes from './routes/health.js';

export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Curio API', description: 'Share-to-knowledge-graph backend (Phase 0)', version: '0.0.1' },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(healthRoutes);
  await app.register(itemsRoutes);
  await app.register(queryRoutes);

  return app;
}
