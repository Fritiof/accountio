import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
/**
 * HTTP route tests against a real Postgres (via `docker compose up -d postgres`).
 * The JournalGenerator is stubbed via the DI seam in createApp — no real
 * Anthropic API calls.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { db } from '../src/db/client.ts';
import { suppliers } from '../src/db/schema.ts';
import { env } from '../src/env.ts';
import { createApp } from '../src/index.ts';
import { BAS_CHART } from '../src/lib/accounts.ts';
import type { JournalGenerator, JournalProposal } from '../src/lib/anthropic.ts';
import {
  balancedProposal,
  unbalancedProposal,
  unknownAccountProposal,
} from './fixtures/proposal.ts';

const sql = postgres(env.DATABASE_URL, { max: 1 });

// sample_invoices/ lives at the repo root locally, but is mounted at
// /app/sample_invoices when running inside the backend docker container.
const SAMPLE_PDF_NATIVE = join(
  import.meta.dir,
  '..',
  '..',
  'sample_invoices',
  'simple_invoice.pdf',
);
const SAMPLE_PDF_DOCKER = join(import.meta.dir, '..', 'sample_invoices', 'simple_invoice.pdf');
const SAMPLE_PDF_PATH = existsSync(SAMPLE_PDF_NATIVE) ? SAMPLE_PDF_NATIVE : SAMPLE_PDF_DOCKER;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  for (const a of BAS_CHART) {
    await sql`INSERT INTO accounts (number, name) VALUES (${a.number}, ${a.name})
              ON CONFLICT (number) DO NOTHING`;
  }
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE postings, journal_entries, bills, bill_drafts, suppliers RESTART IDENTITY CASCADE`;
});

function stub(proposal: JournalProposal = balancedProposal): JournalGenerator {
  return async () => proposal;
}

async function preparePdf(app: ReturnType<typeof createApp>): Promise<Response> {
  const bytes = await readFile(SAMPLE_PDF_PATH);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'simple_invoice.pdf');
  return app.request('/api/bills/prepare', { method: 'POST', body: form });
}

type PrepareResponse = {
  draftId: string;
  proposal: JournalProposal;
  match:
    | { kind: 'exact'; supplier: { id: string; name: string }; matchedBy: string }
    | { kind: 'candidates'; candidates: { id: string; name: string }[] }
    | { kind: 'none' };
};

async function confirmAsNewSupplier(
  app: ReturnType<typeof createApp>,
  draftId: string,
  proposal: JournalProposal,
) {
  return app.request('/api/bills/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      draftId,
      supplier: {
        kind: 'create',
        name: proposal.supplierName ?? 'Unknown',
        orgNumber: proposal.supplierOrgNumber,
        vatNumber: proposal.supplierVatNumber,
      },
    }),
  });
}

// =============================================================================
// GET /api/accounts
// =============================================================================

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

// =============================================================================
// POST /api/bills/prepare
// =============================================================================

describe('POST /api/bills/prepare', () => {
  test('happy path — returns draftId + proposal + match=none for unseen supplier', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const res = await preparePdf(app);
    expect(res.status).toBe(201);
    const body = (await res.json()) as PrepareResponse;
    expect(body.draftId).toBeTruthy();
    expect(body.proposal.supplierName).toBe('Acme Consulting AB');
    expect(body.proposal.supplierOrgNumber).toBe('556677-8899');
    expect(body.match.kind).toBe('none');
  });

  test('returns exact match by org_number when supplier is seeded', async () => {
    await db.insert(suppliers).values({ name: 'Pre-existing Acme', orgNumber: '556677-8899' });
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const res = await preparePdf(app);
    expect(res.status).toBe(201);
    const body = (await res.json()) as PrepareResponse;
    expect(body.match.kind).toBe('exact');
    if (body.match.kind === 'exact') {
      expect(body.match.matchedBy).toBe('org_number');
      expect(body.match.supplier.name).toBe('Pre-existing Acme');
    }
  });

  test('returns 400 without a file field', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/bills/prepare', {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  test('returns 415 for non-PDF', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    const res = await app.request('/api/bills/prepare', { method: 'POST', body: form });
    expect(res.status).toBe(415);
  });

  test('returns 502 if the LLM throws (PDF cleaned up)', async () => {
    const app = createApp({
      db,
      generateJournal: async () => {
        throw new Error('boom');
      },
    });
    const res = await preparePdf(app);
    expect(res.status).toBe(502);
  });
});

// =============================================================================
// POST /api/bills/confirm
// =============================================================================

describe('POST /api/bills/confirm', () => {
  test('confirm with create-new creates supplier + bill + entry + postings', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;

    const res = await confirmAsNewSupplier(app, prep.draftId, prep.proposal);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      bill: { id: string; supplierId: string; supplierName: string };
      journalEntry: { status: string; validationErrors: string | null };
      postings: { accountNumber: string; debit: string; credit: string }[];
    };

    expect(body.bill.supplierId).toBeTruthy();
    expect(body.bill.supplierName).toBe('Acme Consulting AB');
    expect(body.journalEntry.status).toBe('pending');
    expect(body.journalEntry.validationErrors).toBeNull();
    expect(body.postings.length).toBe(3);

    // Supplier was inserted with the proposal's identifiers
    const rows = await db.select().from(suppliers);
    expect(rows.length).toBe(1);
    expect(rows[0]?.orgNumber).toBe('556677-8899');
    expect(rows[0]?.vatNumber).toBe('SE556677889901');
  });

  test('confirm with existing supplier id links the bill to that supplier', async () => {
    const [existing] = await db
      .insert(suppliers)
      .values({ name: 'Pre-existing Acme', orgNumber: '556677-8899' })
      .returning();

    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;

    const res = await app.request('/api/bills/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draftId: prep.draftId,
        supplier: { kind: 'existing', id: existing?.id ?? '' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bill: { supplierId: string } };
    expect(body.bill.supplierId).toBe(existing?.id ?? '');

    // No new supplier was created
    const rows = await db.select().from(suppliers);
    expect(rows.length).toBe(1);
  });

  test('persists validation_errors when LLM returned unbalanced postings', async () => {
    const app = createApp({ db, generateJournal: stub(unbalancedProposal) });
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;
    const res = await confirmAsNewSupplier(app, prep.draftId, prep.proposal);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      journalEntry: { status: string; validationErrors: string | null };
    };
    expect(body.journalEntry.validationErrors).toMatch(/unbalanced/);
  });

  test('persists validation_errors for unknown account', async () => {
    const app = createApp({ db, generateJournal: stub(unknownAccountProposal) });
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;
    const res = await confirmAsNewSupplier(app, prep.draftId, prep.proposal);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      journalEntry: { validationErrors: string | null };
    };
    expect(body.journalEntry.validationErrors).toMatch(/9999/);
  });

  test('404 when draft is unknown', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/bills/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draftId: '00000000-0000-0000-0000-000000000000',
        supplier: { kind: 'create', name: 'Test AB' },
      }),
    });
    expect(res.status).toBe(404);
  });

  test('400 on malformed body', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/bills/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  test('deletes the draft row after confirm', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;
    await confirmAsNewSupplier(app, prep.draftId, prep.proposal);

    const after = await sql`SELECT count(*)::int as c FROM bill_drafts`;
    expect(after[0]?.c).toBe(0);
  });

  test('concurrent confirms for the same draft produce exactly one bill', async () => {
    // Regression test for the double-confirm race. Two POST /confirm calls
    // fired in parallel against the same draftId; the atomic DELETE ...
    // RETURNING inside the transaction means only one wins.
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;

    const [res1, res2] = await Promise.all([
      confirmAsNewSupplier(app, prep.draftId, prep.proposal),
      confirmAsNewSupplier(app, prep.draftId, prep.proposal),
    ]);

    // Exactly one 201 and one 404.
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 404]);

    // Exactly one bill in the DB, not two.
    const billRows = await sql`SELECT count(*)::int as c FROM bills`;
    expect(billRows[0]?.c).toBe(1);

    // Draft is gone.
    const draftRows = await sql`SELECT count(*)::int as c FROM bill_drafts`;
    expect(draftRows[0]?.c).toBe(0);
  });
});

// =============================================================================
// Draft management
// =============================================================================

describe('DELETE /api/bills/drafts/:id', () => {
  test('abandons the draft', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;

    const res = await app.request(`/api/bills/drafts/${prep.draftId}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const after = await sql`SELECT count(*)::int as c FROM bill_drafts`;
    expect(after[0]?.c).toBe(0);
  });

  test('404 for unknown draft', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/bills/drafts/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/bills/drafts/:id/pdf', () => {
  test('streams the draft PDF for preview', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;

    const res = await app.request(`/api/bills/drafts/${prep.draftId}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });
});

// =============================================================================
// GET / detail / pdf / approve / reject — unchanged behaviour
// =============================================================================

describe('GET /api/bills + detail + approve/reject', () => {
  async function uploadAndConfirm(app: ReturnType<typeof createApp>) {
    const prep = (await (await preparePdf(app)).json()) as PrepareResponse;
    const confirmRes = await confirmAsNewSupplier(app, prep.draftId, prep.proposal);
    return (await confirmRes.json()) as { bill: { id: string } };
  }

  test('lists bills newest first', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    await uploadAndConfirm(app);
    await uploadAndConfirm(app);
    const res = await app.request('/api/bills');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bills: { status: string }[] };
    expect(body.bills.length).toBe(2);
    for (const row of body.bills) expect(row.status).toBe('pending');
  });

  test('detail returns full bill', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const created = await uploadAndConfirm(app);
    const res = await app.request(`/api/bills/${created.bill.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { postings: unknown[] };
    expect(body.postings.length).toBe(3);
  });

  test('approve flips status, idempotent', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const created = await uploadAndConfirm(app);
    const first = await app.request(`/api/bills/${created.bill.id}/approve`, { method: 'POST' });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { journalEntry: { status: string } }).journalEntry.status).toBe(
      'approved',
    );
    const second = await app.request(`/api/bills/${created.bill.id}/approve`, { method: 'POST' });
    expect(second.status).toBe(200);
  });

  test('reject flips status', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const created = await uploadAndConfirm(app);
    const res = await app.request(`/api/bills/${created.bill.id}/reject`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { journalEntry: { status: string } }).journalEntry.status).toBe(
      'rejected',
    );
  });

  test('404 approving unknown bill', async () => {
    const app = createApp({ db, generateJournal: stub() });
    const res = await app.request('/api/bills/00000000-0000-0000-0000-000000000000/approve', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  test('PDF stream for confirmed bill', async () => {
    const app = createApp({ db, generateJournal: stub(balancedProposal) });
    const created = await uploadAndConfirm(app);
    const res = await app.request(`/api/bills/${created.bill.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });
});
