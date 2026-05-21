import { Hono } from 'hono';
import type { DB } from '../db/client.ts';
import { loadChart } from '../lib/accounts.ts';

export function createAccountsRoute(db: DB): Hono {
  const route = new Hono();
  route.get('/', async (c) => c.json({ accounts: await loadChart(db) }));
  return route;
}
