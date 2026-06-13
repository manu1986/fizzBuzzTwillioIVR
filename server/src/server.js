import { buildApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';

const app = await buildApp();
try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info('api_listening', { port: config.port, docs: `http://localhost:${config.port}/docs` });
} catch (e) {
  logger.error('api_failed_to_start', { err: String(e) });
  process.exit(1);
}
