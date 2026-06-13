import { buildApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { migrate } from './db/migrate.js';

try {
  await migrate();
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info('api_listening', { port: config.port, docs: `http://localhost:${config.port}/docs` });

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      logger.info('api_shutting_down', { sig });
      await app.close();
      process.exit(0);
    });
  }
} catch (e) {
  logger.error('api_failed_to_start', { err: String(e) });
  process.exit(1);
}
