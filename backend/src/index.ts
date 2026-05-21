import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { db } from './db/client.ts';
import { env } from './env.ts';
import { type JournalGenerator, createAnthropicJournalGenerator } from './lib/anthropic.ts';
import { createAccountsRoute } from './routes/accounts.ts';
import { type BillsRouteDeps, createBillsRoute } from './routes/bills.ts';
import { createSuppliersRoute } from './routes/suppliers.ts';

export function createApp(deps?: Partial<BillsRouteDeps>): Hono {
  const app = new Hono();

  app.use('*', logger());

  if (env.CORS_ORIGIN) {
    const origins = env.CORS_ORIGIN.split(',').map((s) => s.trim());
    app.use('*', cors({ origin: origins, credentials: true }));
  }

  const generateJournal: JournalGenerator =
    deps?.generateJournal ??
    createAnthropicJournalGenerator({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
    });

  app.get('/health', (c) => c.json({ ok: true }));

  const dbInstance = deps?.db ?? db;
  app.route('/api/accounts', createAccountsRoute(dbInstance));
  app.route('/api/suppliers', createSuppliersRoute(dbInstance));
  app.route('/api/bills', createBillsRoute({ db: dbInstance, generateJournal }));

  return app;
}

const app = createApp();

export default {
  port: env.PORT,
  hostname: env.HOST,
  fetch: app.fetch,
};

console.log(`▶ accountio-backend listening on http://${env.HOST}:${env.PORT}`);
