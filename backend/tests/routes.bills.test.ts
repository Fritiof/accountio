import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
/**
 * HTTP route tests against a real Postgres (via `docker compose up -d postgres`).
 * The JournalGenerator is stubbed via the DI seam in createApp — no real
 * Anthropic API calls.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { db } from '../src/db/client.ts';
import { env } from '../src/env.ts';
import { createApp } from '../src/index.ts';
import { BAS_CHART } from '../src/lib/accounts.ts';
import type { JournalGenerator } from '../src/lib/anthropic.ts';
import {
  balancedProposal,
  unbalancedProposal,
  unknownAccountProposal,
} from './fixtures/proposal.ts';

const sql = postgres(env.DATABASE_URL, { max: 1 });

const SAMPLE_PDF_PATH = join(import.meta.dir, '..', '..', 'sample_invoices', 'simple_invoice.pdf');

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  // Migration includes seed INSERTs, but in case the table existed beforehand
  // (e.g. partial run), upsert the chart so tests have a stable baseline.
  for (const a of BAS_CHART) {
    await sql`INSERT INTO accounts (number, name) VALUES (${a.number}, ${a.name})
              ON CONFLICT (number) DO NOTHING`;
  }
});

afterAll(async () => {
  // Only end this file's local `sql` — the shared queryClient from src/db/client.ts
  // is closed automatically on process exit. Closing it here would break sibling
  // test files that import the same singleton.
  await sql.end();
});

beforeEach(async () => {
  // Truncate transactional tables — keep the seeded chart of accounts.
  await sql`TRUNCATE TABLE postings, journal_entries, bills, bill_drafts, suppliers RESTART IDENTITY CASCADE`;
});

function stub(proposal = balancedProposal): JournalGenerator {
  return async () => proposal;
}

async function uploadSamplePdf(app: ReturnType<typeof createApp>): Promise<Response> {
  const bytes = await readFile(SAMPLE_PDF_PATH);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'simple_invoice.pdf');
  return app.request('/api/bills', { method: 'POST', body: form });
}

describe('GET /api/accounts', () => {
  test('returns the full BAS chart (20 rows)', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/accounts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: { number: string; name: string }[] };
    expect(body.accounts.length).toBe(20);
    expect(body.accounts.map((a) => a.number)).toContain('2440');
    expect(body.accounts.map((a) => a.number)).toContain('2640');
  });
});

describe('POST /api/bills', () => {
  test('happy path — upload, generate, validate, persist', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const res = await uploadSamplePdf(app);
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      bill: {
        id: string;
        supplierName: string;
        supplierVatNumber: string;
        grossAmount: string;
      };
      journalEntry: { id: string; status: string; validationErrors: string | null };
      postings: { accountNumber: string; debit: string; credit: string }[];
    };

    expect(body.bill.supplierName).toBe('Acme Consulting AB');
    expect(body.bill.supplierVatNumber).toBe('SE556677889901');
    expect(body.bill.grossAmount).toBe('12500.00');
    expect(body.journalEntry.status).toBe('pending');
    expect(body.journalEntry.validationErrors).toBeNull();
    expect(body.postings.length).toBe(3);

    // Debit/credit totals balance to the cent
    const debit = body.postings.reduce((s, p) => s + Number(p.debit), 0);
    const credit = body.postings.reduce((s, p) => s + Number(p.credit), 0);
    expect(debit).toBe(credit);

    // Required accounts present
    expect(body.postings.map((p) => p.accountNumber)).toContain('2440');
    expect(body.postings.map((p) => p.accountNumber)).toContain('2640');
  });

  test('persists with validation_errors when LLM returns unbalanced postings', async () => {
    const app = createApp({ db, generateJournal: stub(unbalancedProposal) });
    const res = await uploadSamplePdf(app);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      journalEntry: { status: string; validationErrors: string | null };
    };
    expect(body.journalEntry.status).toBe('pending');
    expect(body.journalEntry.validationErrors).toMatch(/unbalanced/);
  });

  test('persists with validation_errors when LLM picks an unknown account', async () => {
    const app = createApp({ db, generateJournal: stub(unknownAccountProposal) });
    const res = await uploadSamplePdf(app);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      journalEntry: { validationErrors: string | null };
    };
    expect(body.journalEntry.validationErrors).toMatch(/9999/);
  });

  test('rejects requests without a file field', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/bills', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });

  test('rejects non-PDF uploads', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    const res = await app.request('/api/bills', { method: 'POST', body: form });
    expect(res.status).toBe(415);
  });

  test('returns 502 if the LLM generator throws', async () => {
    const app = createApp({
      db,
      generateJournal: async () => {
        throw new Error('boom');
      },
    });
    const res = await uploadSamplePdf(app);
    expect(res.status).toBe(502);
  });
});

describe('GET /api/bills', () => {
  test('lists bills newest first with status', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    await uploadSamplePdf(app);
    await uploadSamplePdf(app);

    const res = await app.request('/api/bills');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bills: { id: string; status: string; createdAt: string }[];
    };
    expect(body.bills.length).toBe(2);
    for (const row of body.bills) {
      expect(row.status).toBe('pending');
    }
    const [first, second] = body.bills;
    if (!first || !second) throw new Error('expected 2 bills');
    expect(new Date(first.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(second.createdAt).getTime(),
    );
  });
});

describe('GET /api/bills/:id', () => {
  test('returns full detail', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const created = (await (await uploadSamplePdf(app)).json()) as { bill: { id: string } };

    const res = await app.request(`/api/bills/${created.bill.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bill: { id: string };
      journalEntry: { status: string };
      postings: unknown[];
    };
    expect(body.bill.id).toBe(created.bill.id);
    expect(body.postings.length).toBe(3);
  });

  test('returns 404 for missing bill', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/bills/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/bills/:id/pdf', () => {
  test('streams the stored PDF inline', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const created = (await (await uploadSamplePdf(app)).json()) as { bill: { id: string } };

    const res = await app.request(`/api/bills/${created.bill.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/inline/);
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });
});

describe('POST /api/bills/:id/approve|reject', () => {
  test('approve flips status and is idempotent', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const created = (await (await uploadSamplePdf(app)).json()) as { bill: { id: string } };

    const first = await app.request(`/api/bills/${created.bill.id}/approve`, { method: 'POST' });
    expect(first.status).toBe(200);
    const b1 = (await first.json()) as {
      journalEntry: { status: string; decidedAt: string | null };
    };
    expect(b1.journalEntry.status).toBe('approved');
    expect(b1.journalEntry.decidedAt).not.toBeNull();

    // Idempotent — second approve returns the same state, doesn't error
    const second = await app.request(`/api/bills/${created.bill.id}/approve`, { method: 'POST' });
    expect(second.status).toBe(200);
    const b2 = (await second.json()) as { journalEntry: { status: string } };
    expect(b2.journalEntry.status).toBe('approved');
  });

  test('reject flips status', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const created = (await (await uploadSamplePdf(app)).json()) as { bill: { id: string } };

    const res = await app.request(`/api/bills/${created.bill.id}/reject`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { journalEntry: { status: string } };
    expect(body.journalEntry.status).toBe('rejected');
  });

  test('404 for unknown bill', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/bills/00000000-0000-0000-0000-000000000000/approve', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });
});
