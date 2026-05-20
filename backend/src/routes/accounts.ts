import { Hono } from 'hono';
import { BAS_CHART } from '../lib/accounts.ts';

export const accountsRoute = new Hono();

accountsRoute.get('/', (c) => c.json({ accounts: BAS_CHART }));
