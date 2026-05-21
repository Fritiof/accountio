import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { balancedProposal } from '../../tests/fixtures/proposal.ts';
import { db } from '../db/client.ts';
import { suppliers } from '../db/schema.ts';
import { env } from '../env.ts';
import { createApp } from '../index.ts';

const sql = postgres(env.DATABASE_URL, { max: 1 });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE postings, journal_entries, bills, bill_drafts, suppliers RESTART IDENTITY CASCADE`;
});

describe('GET /api/suppliers', () => {
  test('returns empty list when no suppliers exist', async () => {
    const app = createApp({ db, generateJournal: async () => balancedProposal });
    const res = await app.request('/api/suppliers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suppliers: unknown[] };
    expect(body.suppliers).toEqual([]);
  });

  test('returns all suppliers newest first', async () => {
    await db.insert(suppliers).values([
      { name: 'Acme AB', orgNumber: '111111-1111' },
      { name: 'Beta AB', orgNumber: '222222-2222' },
    ]);
    const app = createApp({ db, generateJournal: async () => balancedProposal });
    const res = await app.request('/api/suppliers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suppliers: { name: string }[] };
    expect(body.suppliers.length).toBe(2);
  });

  test('filters by ?q=substring (case-insensitive)', async () => {
    await db
      .insert(suppliers)
      .values([
        { name: 'Acme Consulting AB' },
        { name: 'Acme Industries AB' },
        { name: 'Unrelated Ltd' },
      ]);
    const app = createApp({ db, generateJournal: async () => balancedProposal });
    const res = await app.request('/api/suppliers?q=acme');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suppliers: { name: string }[] };
    expect(body.suppliers.length).toBe(2);
    expect(body.suppliers.every((s) => s.name.toLowerCase().includes('acme'))).toBe(true);
  });
});

describe('GET /api/suppliers/:id', () => {
  test('returns supplier + bill count', async () => {
    const [s] = await db
      .insert(suppliers)
      .values({ name: 'Acme AB', orgNumber: '556677-8899' })
      .returning();
    const app = createApp({ db, generateJournal: async () => balancedProposal });

    const res = await app.request(`/api/suppliers/${s?.id ?? ''}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      supplier: { name: string; orgNumber: string };
      billCount: number;
    };
    expect(body.supplier.name).toBe('Acme AB');
    expect(body.supplier.orgNumber).toBe('556677-8899');
    expect(body.billCount).toBe(0);
  });

  test('returns 404 for unknown supplier', async () => {
    const app = createApp({ db, generateJournal: async () => balancedProposal });
    const res = await app.request('/api/suppliers/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
