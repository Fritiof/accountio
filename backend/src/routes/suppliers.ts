/**
 * Read-only supplier endpoints.
 *
 *   GET /api/suppliers          — list, newest first, optional ?q=<substring>
 *   GET /api/suppliers/:id      — single supplier + count of linked bills
 *
 * The confirm route is the only path that *writes* to suppliers; this file
 * is intentionally just lookup.
 */
import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { DB } from '../db/client.ts';
import { bills } from '../db/schema.ts';
import { getSupplierById, listSuppliers } from '../lib/suppliers.ts';

export function createSuppliersRoute(db: DB): Hono {
  const route = new Hono();

  route.get('/', async (c) => {
    const q = c.req.query('q');
    const suppliers = await listSuppliers(db, q);
    return c.json({ suppliers });
  });

  route.get('/:id', async (c) => {
    const id = c.req.param('id');
    const supplier = await getSupplierById(db, id);
    if (!supplier) throw new HTTPException(404, { message: 'Supplier not found.' });
    const [linked] = await db
      .select({ count: count() })
      .from(bills)
      .where(eq(bills.supplierId, id));
    return c.json({ supplier, billCount: linked?.count ?? 0 });
  });

  return route;
}
