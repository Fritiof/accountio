import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './env.ts';

export function createApp(): Hono {
  const app = new Hono();

  app.use('*', logger());

  if (env.CORS_ORIGIN) {
    const origins = env.CORS_ORIGIN.split(',').map((s) => s.trim());
    app.use('*', cors({ origin: origins, credentials: true }));
  }

  app.get('/health', (c) => c.json({ ok: true }));

  return app;
}

const app = createApp();

export default {
  port: env.PORT,
  hostname: env.HOST,
  fetch: app.fetch,
};

console.log(`▶ accountio-backend listening on http://${env.HOST}:${env.PORT}`);
